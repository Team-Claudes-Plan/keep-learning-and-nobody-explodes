//! Wire format of the user channel, see `schema/user-channel.md`.
//!
//! Every message is a JSON object tagged by `type`.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::db::UserSummary;

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMessage {
    /// Invites an island partner into a waiting game of the sender.
    /// `storey_id` names the storey (skill) the game is played on.
    Invite {
        request_id: String,
        to: Uuid,
        island_id: Uuid,
        topic_id: Uuid,
        storey_id: String,
        game_id: Uuid,
    },
    /// The invitee accepts or declines.
    AnswerInvite { invite_id: Uuid, accept: bool },
    /// The inviter takes the invite back.
    CancelInvite { invite_id: Uuid },
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMessage {
    /// An island partner came online or went offline.
    Presence { user_id: Uuid, online: bool },
    /// The invite with `request_id` was passed on.
    InviteSent { request_id: String, invite_id: Uuid },
    Invite {
        invite_id: Uuid,
        from: UserSummary,
        island_id: Uuid,
        topic_id: Uuid,
        storey_id: String,
        game_id: Uuid,
    },
    /// To the inviter.
    InviteAnswered { invite_id: Uuid, accepted: bool },
    /// The invite is gone: taken back, answered in another tab, or its
    /// inviter or invitee went offline.
    InviteCancelled { invite_id: Uuid },
    Error {
        #[serde(skip_serializing_if = "Option::is_none")]
        request_id: Option<String>,
        code: ErrorCode,
        message: String,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    BadMessage,
    /// The invitee has no open channel.
    PartnerOffline,
    /// Sender or invitee is not a member of the island.
    NotIslandMember,
    /// No waiting game of the sender with that id.
    UnknownGame,
    /// No open invite with that id for this user.
    UnknownInvite,
    Internal,
}
