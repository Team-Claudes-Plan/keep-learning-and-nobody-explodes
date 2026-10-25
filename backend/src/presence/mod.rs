//! The user channel: who of a user's island partners is online, and game
//! invites between them. Everything lives in memory; a restart drops the
//! open invites and clients reconnect.
//!
//! A user is online while they have at least one open channel (several tabs
//! are fine). [`Hub`] holds no IO; the websocket glue in `api/presence.rs`
//! checks memberships and games before it calls in.

pub mod protocol;

use std::{
    collections::HashMap,
    sync::{Arc, Mutex, PoisonError},
};

use tokio::sync::mpsc;
use uuid::Uuid;

use crate::db::UserSummary;
use protocol::{ErrorCode, ServerMessage};

/// Messages pushed to one channel.
pub type Outbox = mpsc::UnboundedReceiver<Arc<ServerMessage>>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Invite {
    pub id: Uuid,
    pub from: UserSummary,
    pub to: Uuid,
    pub island_id: Uuid,
    pub topic_id: Uuid,
    pub storey_id: String,
    pub game_id: Uuid,
}

impl Invite {
    fn message(&self) -> ServerMessage {
        ServerMessage::Invite {
            invite_id: self.id,
            from: self.from.clone(),
            island_id: self.island_id,
            topic_id: self.topic_id,
            storey_id: self.storey_id.clone(),
            game_id: self.game_id,
        }
    }
}

/// An invite request that passed the membership and game checks.
#[derive(Debug, Clone)]
pub struct NewInvite {
    pub from: UserSummary,
    pub to: Uuid,
    pub island_id: Uuid,
    pub topic_id: Uuid,
    pub storey_id: String,
    pub game_id: Uuid,
}

#[derive(Debug, thiserror::Error)]
#[error("{message}")]
pub struct PresenceError {
    pub code: ErrorCode,
    pub message: String,
}

impl PresenceError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    #[must_use]
    pub fn to_message(&self, request_id: Option<String>) -> ServerMessage {
        ServerMessage::Error {
            request_id,
            code: self.code,
            message: self.message.clone(),
        }
    }
}

/// One open channel of a user.
#[derive(Debug)]
pub struct Channel {
    pub id: u64,
    pub outbox: Outbox,
}

#[derive(Debug, Default)]
struct User {
    channels: Vec<(u64, mpsc::UnboundedSender<Arc<ServerMessage>>)>,
    /// Island partners as of the first channel; they hear about this user.
    partners: Vec<Uuid>,
}

#[derive(Debug, Default)]
struct Inner {
    users: HashMap<Uuid, User>,
    invites: HashMap<Uuid, Invite>,
    next_channel: u64,
}

impl Inner {
    fn is_online(&self, user: Uuid) -> bool {
        self.users
            .get(&user)
            .is_some_and(|user| !user.channels.is_empty())
    }

    fn send(&self, user: Uuid, message: &Arc<ServerMessage>) {
        let Some(user) = self.users.get(&user) else {
            return;
        };
        for (_, channel) in &user.channels {
            // a closed channel is about to unregister
            let _ = channel.send(Arc::clone(message));
        }
    }

    fn tell_partners(&self, user: Uuid, online: bool) {
        let Some(partners) = self.users.get(&user).map(|u| u.partners.clone()) else {
            return;
        };
        let message = Arc::new(ServerMessage::Presence {
            user_id: user,
            online,
        });
        for partner in partners {
            self.send(partner, &message);
        }
    }

    fn cancel(&mut self, invite_id: Uuid) -> Option<Invite> {
        let invite = self.invites.remove(&invite_id)?;
        let message = Arc::new(ServerMessage::InviteCancelled { invite_id });
        self.send(invite.to, &message);
        self.send(invite.from.id, &message);
        Some(invite)
    }
}

#[derive(Debug, Default)]
pub struct Hub {
    inner: Mutex<Inner>,
}

impl Hub {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        // the state stays consistent between statements, so a panic elsewhere
        // does not poison it for good
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Opens a channel for `user`. Its outbox starts with the presence of
    /// every partner and the invites still open for the user.
    pub fn connect(&self, user: Uuid, partners: Vec<Uuid>) -> Channel {
        let mut inner = self.lock();
        let (sender, outbox) = mpsc::unbounded_channel();
        for &partner in &partners {
            let _ = sender.send(Arc::new(ServerMessage::Presence {
                user_id: partner,
                online: inner.is_online(partner),
            }));
        }
        for invite in inner.invites.values().filter(|invite| invite.to == user) {
            let _ = sender.send(Arc::new(invite.message()));
        }

        inner.next_channel += 1;
        let id = inner.next_channel;
        let came_online = !inner.is_online(user);
        let entry = inner.users.entry(user).or_default();
        entry.channels.push((id, sender));
        entry.partners = partners;
        if came_online {
            inner.tell_partners(user, true);
        }
        Channel { id, outbox }
    }

    /// Closes a channel. When the user's last channel closes, their partners
    /// see them go offline and every invite from or to them is cancelled.
    pub fn disconnect(&self, user: Uuid, channel: u64) {
        let mut inner = self.lock();
        let Some(entry) = inner.users.get_mut(&user) else {
            return;
        };
        entry.channels.retain(|(id, _)| *id != channel);
        if !entry.channels.is_empty() {
            return;
        }
        inner.tell_partners(user, false);
        let gone: Vec<Uuid> = inner
            .invites
            .values()
            .filter(|invite| invite.from.id == user || invite.to == user)
            .map(|invite| invite.id)
            .collect();
        for invite in gone {
            inner.cancel(invite);
        }
        inner.users.remove(&user);
    }

    #[must_use]
    pub fn is_online(&self, user: Uuid) -> bool {
        self.lock().is_online(user)
    }

    /// Passes an invite on to its invitee, who must be online.
    pub fn invite(&self, invite: NewInvite) -> Result<Uuid, PresenceError> {
        let mut inner = self.lock();
        if !inner.is_online(invite.to) {
            return Err(PresenceError::new(
                ErrorCode::PartnerOffline,
                "the partner is offline",
            ));
        }
        let invite = Invite {
            id: Uuid::new_v4(),
            from: invite.from,
            to: invite.to,
            island_id: invite.island_id,
            topic_id: invite.topic_id,
            storey_id: invite.storey_id,
            game_id: invite.game_id,
        };
        inner.send(invite.to, &Arc::new(invite.message()));
        let id = invite.id;
        inner.invites.insert(id, invite);
        Ok(id)
    }

    /// The invite `invite_id` sent to `user`.
    pub fn invite_to(&self, user: Uuid, invite_id: Uuid) -> Result<Invite, PresenceError> {
        self.lock()
            .invites
            .get(&invite_id)
            .filter(|invite| invite.to == user)
            .cloned()
            .ok_or_else(unknown_invite)
    }

    /// The invitee answers; the inviter hears it, and the invitee's other
    /// tabs drop the invite.
    pub fn answer(&self, user: Uuid, invite_id: Uuid, accept: bool) -> Result<(), PresenceError> {
        let mut inner = self.lock();
        if inner
            .invites
            .get(&invite_id)
            .is_none_or(|invite| invite.to != user)
        {
            return Err(unknown_invite());
        }
        let invite = inner
            .invites
            .remove(&invite_id)
            .ok_or_else(unknown_invite)?;
        inner.send(
            invite.from.id,
            &Arc::new(ServerMessage::InviteAnswered {
                invite_id,
                accepted: accept,
            }),
        );
        inner.send(
            invite.to,
            &Arc::new(ServerMessage::InviteCancelled { invite_id }),
        );
        Ok(())
    }

    /// The inviter takes an invite back.
    pub fn cancel(&self, user: Uuid, invite_id: Uuid) -> Result<(), PresenceError> {
        let mut inner = self.lock();
        if inner
            .invites
            .get(&invite_id)
            .is_none_or(|invite| invite.from.id != user)
        {
            return Err(unknown_invite());
        }
        inner.cancel(invite_id);
        Ok(())
    }

    /// Withdraws an invite whose game cannot be joined any more.
    pub fn withdraw(&self, invite_id: Uuid) {
        self.lock().cancel(invite_id);
    }

    /// `by` made `user` a member of an island. The user hears about it, and
    /// the two become partners now rather than on their next connect.
    pub fn added_to_island(&self, island_id: Uuid, by: UserSummary, user: Uuid) {
        let mut inner = self.lock();
        let by_id = by.id;
        inner.send(
            user,
            &Arc::new(ServerMessage::AddedToIsland { island_id, by }),
        );
        for (own, other) in [(user, by_id), (by_id, user)] {
            let online = inner.is_online(other);
            let Some(entry) = inner.users.get_mut(&own) else {
                continue;
            };
            if entry.partners.contains(&other) {
                continue;
            }
            entry.partners.push(other);
            inner.send(
                own,
                &Arc::new(ServerMessage::Presence {
                    user_id: other,
                    online,
                }),
            );
        }
    }
}

fn unknown_invite() -> PresenceError {
    PresenceError::new(ErrorCode::UnknownInvite, "no such open invite")
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALEX: Uuid = Uuid::from_u128(1);
    const MIA: Uuid = Uuid::from_u128(2);
    const LEO: Uuid = Uuid::from_u128(3);

    fn drain(channel: &mut Channel) -> Vec<ServerMessage> {
        let mut messages = Vec::new();
        while let Ok(message) = channel.outbox.try_recv() {
            messages.push((*message).clone());
        }
        messages
    }

    fn presence(user_id: Uuid, online: bool) -> ServerMessage {
        ServerMessage::Presence { user_id, online }
    }

    fn invite(hub: &Hub) -> Uuid {
        hub.invite(NewInvite {
            from: UserSummary {
                id: ALEX,
                name: "Alex".to_owned(),
            },
            to: MIA,
            island_id: Uuid::from_u128(10),
            topic_id: Uuid::from_u128(11),
            storey_id: "skill".to_owned(),
            game_id: Uuid::from_u128(12),
        })
        .expect("mia is online")
    }

    #[test]
    fn partners_see_each_other_come_and_go() {
        let hub = Hub::new();
        let mut alex = hub.connect(ALEX, vec![MIA]);
        assert_eq!(drain(&mut alex), [presence(MIA, false)]);

        let mut mia = hub.connect(MIA, vec![ALEX]);
        assert_eq!(drain(&mut mia), [presence(ALEX, true)]);
        assert_eq!(drain(&mut alex), [presence(MIA, true)]);

        // a second tab changes nothing for the partner
        let second = hub.connect(MIA, vec![ALEX]);
        assert_eq!(drain(&mut alex), []);
        hub.disconnect(MIA, mia.id);
        assert_eq!(drain(&mut alex), [], "mia is still online");
        hub.disconnect(MIA, second.id);
        assert_eq!(drain(&mut alex), [presence(MIA, false)]);
        assert!(!hub.is_online(MIA));
    }

    #[test]
    fn an_invite_reaches_every_tab_and_its_answer_the_inviter() {
        let hub = Hub::new();
        let mut alex = hub.connect(ALEX, vec![MIA]);
        let mut mia = hub.connect(MIA, vec![ALEX]);
        let mut mia_too = hub.connect(MIA, vec![ALEX]);
        drain(&mut alex);
        drain(&mut mia);
        drain(&mut mia_too);

        let id = invite(&hub);
        assert!(
            matches!(drain(&mut mia).as_slice(), [ServerMessage::Invite { invite_id, .. }] if *invite_id == id)
        );
        assert_eq!(drain(&mut mia_too).len(), 1);
        assert_eq!(
            hub.invite_to(MIA, id).expect("open").game_id,
            Uuid::from_u128(12)
        );
        hub.invite_to(ALEX, id).expect_err("only for the invitee");

        assert_eq!(
            hub.answer(ALEX, id, true)
                .expect_err("not alex's to answer")
                .code,
            ErrorCode::UnknownInvite
        );
        hub.answer(MIA, id, true).expect("answer");
        assert_eq!(
            drain(&mut alex),
            [ServerMessage::InviteAnswered {
                invite_id: id,
                accepted: true
            }]
        );
        assert_eq!(
            drain(&mut mia_too),
            [ServerMessage::InviteCancelled { invite_id: id }],
            "the other tab drops it"
        );
        assert_eq!(
            hub.answer(MIA, id, false).expect_err("answered").code,
            ErrorCode::UnknownInvite
        );
    }

    #[test]
    fn a_new_member_hears_it_and_both_become_partners() {
        let hub = Hub::new();
        let alex_summary = UserSummary {
            id: ALEX,
            name: "Alex".to_owned(),
        };
        let island = Uuid::from_u128(10);
        let mut alex = hub.connect(ALEX, vec![]);
        let mut mia = hub.connect(MIA, vec![]);
        assert_eq!(drain(&mut alex), []);

        hub.added_to_island(island, alex_summary.clone(), MIA);
        assert_eq!(
            drain(&mut mia),
            [
                ServerMessage::AddedToIsland {
                    island_id: island,
                    by: alex_summary.clone()
                },
                presence(ALEX, true)
            ]
        );
        assert_eq!(drain(&mut alex), [presence(MIA, true)]);

        // a second island together is no news for presence
        hub.added_to_island(Uuid::from_u128(11), alex_summary, MIA);
        assert_eq!(drain(&mut mia).len(), 1);
        assert_eq!(drain(&mut alex), []);

        hub.disconnect(MIA, mia.id);
        assert_eq!(drain(&mut alex), [presence(MIA, false)]);
    }

    #[test]
    fn offline_partners_cannot_be_invited() {
        let hub = Hub::new();
        let _alex = hub.connect(ALEX, vec![MIA]);
        let error = hub
            .invite(NewInvite {
                from: UserSummary {
                    id: ALEX,
                    name: "Alex".to_owned(),
                },
                to: LEO,
                island_id: Uuid::nil(),
                topic_id: Uuid::nil(),
                storey_id: String::new(),
                game_id: Uuid::nil(),
            })
            .expect_err("leo is offline");
        assert_eq!(error.code, ErrorCode::PartnerOffline);
    }

    #[test]
    fn open_invites_are_replayed_to_a_new_tab() {
        let hub = Hub::new();
        let _alex = hub.connect(ALEX, vec![MIA]);
        let _mia = hub.connect(MIA, vec![ALEX]);
        let id = invite(&hub);
        let mut later = hub.connect(MIA, vec![ALEX]);
        assert!(drain(&mut later).iter().any(
            |message| matches!(message, ServerMessage::Invite { invite_id, .. } if *invite_id == id)
        ));
    }

    #[test]
    fn invites_end_with_their_inviter_or_on_cancel() {
        let hub = Hub::new();
        let alex = hub.connect(ALEX, vec![MIA]);
        let mut mia = hub.connect(MIA, vec![ALEX]);
        let first = invite(&hub);
        assert_eq!(
            hub.cancel(MIA, first).expect_err("only the inviter").code,
            ErrorCode::UnknownInvite
        );
        hub.cancel(ALEX, first).expect("cancel");
        let second = invite(&hub);
        drain(&mut mia);

        hub.disconnect(ALEX, alex.id);
        assert_eq!(
            drain(&mut mia),
            [
                presence(ALEX, false),
                ServerMessage::InviteCancelled { invite_id: second }
            ]
        );
        hub.invite_to(MIA, second).expect_err("cancelled with alex");
    }
}
