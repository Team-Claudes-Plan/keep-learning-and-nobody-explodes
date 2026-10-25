import { expect, test, type Browser, type Page } from '@playwright/test'
import { RIGHT, SKILLS, seed, type Seed } from './seed'

// Two island partners play the storeys of a house over the real websocket protocol: presence and
// the invite go through /api/users/ws, the game through /api/sessions/ws.

type Players = { alex: Page; mia: Page }

async function open(browser: Browser, userId: string, path: string): Promise<Page> {
  const context = await browser.newContext()
  await context.addInitScript((id) => window.localStorage.setItem('userId', id), userId)
  const page = await context.newPage()
  await page.goto(path)
  return page
}

const housePath = (s: Seed) => `/islands/${s.islandId}/houses/${s.topicId}`

function storeys(page: Page) {
  return page.getByRole('list', { name: 'Storeys' })
}

/** Alex invites Mia to the storey; Mia accepts, both press "Bereit". Only then both get to the game page. */
async function startStorey(players: Players, s: Seed, storey: string) {
  const { alex, mia } = players
  await storeys(alex).getByRole('link', { name: new RegExp(storey) }).click()
  await expect(alex.getByText(`mit ${s.mia.name} · online`)).toBeVisible()
  await alex.getByRole('button', { name: '▶ Session starten' }).click()

  const invite = mia.getByRole('alertdialog', { name: `📨 Einladung von ${s.alex.name}` })
  await expect(invite).toContainText(storey)
  await invite.getByRole('button', { name: 'Annehmen' }).click()

  // the first one ready still waits for the other, on the same page
  const ready = (page: Page) => page.getByRole('button', { name: 'Bereit' })
  await expect(ready(alex)).toBeEnabled()
  await ready(alex).click()
  await expect(alex.getByText(`Warte auf ${s.mia.name}`)).toBeVisible()
  await expect(alex).toHaveURL(new RegExp(`${housePath(s)}$`))
  await expect(ready(mia)).toBeEnabled()
  await ready(mia).click()

  await expect(alex).toHaveURL(/\/koop\/spiel\//)
  await expect(mia).toHaveURL(/\/koop\/spiel\/.*rolle=expert/)
  for (const page of [alex, mia]) await expect(screen(page)).toHaveAttribute('data-status', 'active')
}

function screen(page: Page) {
  return page.locator('.bomb-screen')
}

/** The page of the defuser and of the expert; the roles hold for the whole bomb. */
async function rolesOf(players: Players): Promise<{ defuser: Page; expert: Page }> {
  const { alex, mia } = players
  for (const page of [alex, mia]) await expect(screen(page)).toHaveAttribute('data-role', /defuser|expert/)
  const alexRole = await screen(alex).getAttribute('data-role')
  return alexRole === 'defuser' ? { defuser: alex, expert: mia } : { defuser: mia, expert: alex }
}

/** Modules on the bomb that are not answered yet, with their symbols. */
async function openParts(defuser: Page): Promise<{ position: number; glyphs: number[] }[]> {
  await defuser.waitForFunction(() => (window.__bomb?.parts.length ?? 0) > 0)
  const parts = await defuser.evaluate(() => window.__bomb?.parts ?? [])
  const done = await defuser.locator('.bomb-screen').getAttribute('data-done')
  const answered = new Set((done ?? '').split(',').filter(Boolean).map(Number))
  return parts.filter((part) => !answered.has(part.position))
}

/** Leafs through the manual until the page explaining `glyph` is open. */
async function findPage(expert: Page, glyph: number) {
  const page = expert.locator('.book-paper', { has: expert.locator(`.book-glyphs li[data-glyph="${glyph}"]`) })
  const next = expert.getByRole('button', { name: 'Weiter ▶' })
  for (let turns = 0; turns < 20 && (await page.count()) === 0; turns++) {
    await expect(next).toBeEnabled()
    await next.click()
  }
  await expect(page).toBeVisible()
  return page
}

/**
 * The defuser describes a symbol of a module, the expert finds the page it is on and says which
 * symbol to pick, and the defuser picks it on the bomb.
 */
async function playPart(players: Players, part: { position: number; glyphs: number[] }, pick: 'right' | 'wrong') {
  const { defuser, expert } = await rolesOf(players)
  const page = await findPage(expert, part.glyphs[0])
  const symbols = page.locator('.book-glyphs li[data-glyph]')
  await expect(symbols).toHaveCount(2)
  // nothing on the page says which module it belongs to
  await expect(page.locator('h2')).toHaveCount(0)
  const said = symbols.filter(pick === 'right' ? { hasText: RIGHT } : { hasNotText: RIGHT })
  const glyph = Number(await said.getAttribute('data-glyph'))

  const sent = await defuser.evaluate(([p, g]) => window.__bomb?.chooseGlyph(p, g), [part.position, glyph])
  expect(sent).toBe(true)
}

/** Plays the open modules, last one first (any order works), until the game ends. */
async function playAll(players: Players, pick: 'right' | 'wrong') {
  const { defuser } = await rolesOf(players)
  const parts = (await openParts(defuser)).reverse()
  for (const part of parts) {
    if ((await screen(players.alex).getAttribute('data-status')) !== 'active') return
    await playPart(players, part, pick)
    await expect(screen(players.alex)).toHaveAttribute('data-done', new RegExp(`(^|,)${part.position}(,|$)`))
  }
}

test.describe('a storey session between two island partners', () => {
  let s: Seed
  let players: Players

  test.beforeEach(async ({ browser }) => {
    s = await seed()
    players = {
      alex: await open(browser, s.alex.id, housePath(s)),
      mia: await open(browser, s.mia.id, `/islands/${s.islandId}`),
    }
    // the house shows every storey: the ground floor to play, the ones above locked
    await expect(storeys(players.alex).getByRole('link')).toHaveCount(SKILLS.length)
    await expect(storeys(players.alex).locator('[data-storey="next"]')).toContainText(SKILLS[0])
    await expect(storeys(players.alex).locator('[data-storey="locked"]')).toHaveCount(SKILLS.length - 1)
  })

  test.afterEach(async () => {
    for (const page of [players.alex, players.mia]) await page.context().close()
  })

  test('winning the ground floor unlocks the next storey', async () => {
    await startStorey(players, s, SKILLS[0])
    // 4 modules on the ground floor, from 3 tasks: one repeats
    await expect(players.alex.locator('.session-bar')).toContainText('0 / 4 Module')
    await playAll(players, 'right')

    for (const page of [players.alex, players.mia]) {
      await expect(screen(page)).toHaveAttribute('data-status', 'won')
      await expect(page.getByText('Stockwerk geschafft: das nächste ist frei!')).toBeVisible()
    }
    await players.alex.getByRole('button', { name: /Zurück zum Haus/ }).click()
    await expect(players.alex).toHaveURL(new RegExp(`${housePath(s)}$`))
    await expect(storeys(players.alex).locator('[data-storey="locked"]')).toHaveCount(SKILLS.length - 2)
    await expect(storeys(players.alex).getByRole('link', { name: new RegExp(SKILLS[0]) })).toContainText('✓ passed')
    await expect(storeys(players.alex).getByRole('link', { name: new RegExp(SKILLS[1]) })).toContainText('▶ up next')

    // the next storey has a bigger bomb
    await startStorey(players, s, SKILLS[1])
    await expect(players.alex.locator('.session-bar')).toContainText('0 / 5 Module')
  })

  test('three strikes blow up the bomb and the storey stays closed', async () => {
    await startStorey(players, s, SKILLS[0])
    await playAll(players, 'wrong')

    for (const page of [players.alex, players.mia]) {
      await expect(screen(page)).toHaveAttribute('data-status', 'lost')
      await expect(page.getByText('Drei Fehler.')).toBeVisible()
    }
    // the expert sees the bomb go off too
    const expert = (await screen(players.alex).getAttribute('data-role')) === 'expert' ? players.alex : players.mia
    await expect(expert.locator('.blast-overlay .bomb-flash')).toBeAttached()
    await players.mia.getByRole('button', { name: /Zurück zum Haus/ }).click()
    await expect(storeys(players.mia).locator('[data-storey="next"]')).toContainText(SKILLS[0])
    await expect(storeys(players.mia).locator('[data-storey="locked"]')).toHaveCount(SKILLS.length - 1)
  })

  test('a reloaded page resumes the running game', async () => {
    await startStorey(players, s, SKILLS[0])
    const { defuser } = await rolesOf(players)
    const [first] = await openParts(defuser)
    await playPart(players, first, 'right')
    await expect(screen(defuser)).toHaveAttribute('data-done', String(first.position))

    await defuser.reload()
    await expect(screen(defuser)).toHaveAttribute('data-role', 'defuser')
    await expect(screen(defuser)).toHaveAttribute('data-done', String(first.position))
    await expect(defuser.locator('.session-bar')).toContainText('1 / 4 Module')

    await playAll(players, 'right')
    await expect(screen(players.alex)).toHaveAttribute('data-status', 'won')
  })

  test('a declined invite ends the waiting game', async () => {
    const { alex, mia } = players
    await storeys(alex).getByRole('link', { name: new RegExp(SKILLS[0]) }).click()
    await expect(alex.getByText(`mit ${s.mia.name} · online`)).toBeVisible()
    await alex.getByRole('button', { name: '▶ Session starten' }).click()
    await expect(alex.getByText(`Warte auf ${s.mia.name}`)).toBeVisible()

    await mia.getByRole('alertdialog').getByRole('button', { name: 'Ablehnen' }).click()
    await expect(alex.getByRole('alert')).toContainText('Abgelehnt')
    await expect(mia.getByRole('alertdialog')).toHaveCount(0)
    await expect(alex).toHaveURL(new RegExp(`${housePath(s)}$`))
  })
})
