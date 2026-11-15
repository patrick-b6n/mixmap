//! Network sync: identity, mDNS discovery and the LAN listener other instances talk to.

pub mod discovery;
pub mod identity;
pub mod server;

pub use discovery::{Discovery, Peer, PROTOCOL};
pub use identity::Device;
