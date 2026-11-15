//! Network sync: identity, mDNS discovery and the LAN listener other instances talk to.

pub mod crypto;
pub mod discovery;
pub mod exchange;
pub mod hub;
pub mod identity;
pub mod paired;
pub mod server;

pub use discovery::{Discovery, Peer, PROTOCOL};
pub use hub::SyncHub;
pub use identity::Device;
