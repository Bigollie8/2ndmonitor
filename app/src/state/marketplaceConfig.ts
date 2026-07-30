// Marketplace server config — the URL + pinned signing pubkey every
// marketplace-backed fetch/install/uninstall call uses. Single source of
// truth: both ContentLibrary (fetches the index, installs/removes bundles)
// and Settings' Marketplace pane (edits the override) import this module
// rather than each holding their own copy — two sources of truth for a
// pinned signing key is exactly the kind of thing that silently breaks when
// the key rotates.
export const LS_URL = 'marketplace.url';
export const LS_PUBKEY = 'marketplace.pubkey';

// Official hub marketplace, pre-configured so the catalog works with no
// setup. The pinned key is the server's ed25519 index-signing public key; if
// it ever rotates, bundles fail signature verification until this (or the
// user's override, edited from Settings → Marketplace) is updated.
export const DEFAULT_URL = 'https://market.basedsecurity.net';
export const DEFAULT_PUBKEY = '35a3b117c5e6ed793b5b78640db3075c48feb0d943541d86f3b462c9bed8d816';

/** Effective server config: user override if they pointed at their own
 *  server, otherwise the built-in default. */
export const cfgUrl = (): string => localStorage.getItem(LS_URL) || DEFAULT_URL;
export const cfgPubkey = (): string => localStorage.getItem(LS_PUBKEY) || DEFAULT_PUBKEY;
export const isDefaultServer = (): boolean => cfgUrl() === DEFAULT_URL && cfgPubkey() === DEFAULT_PUBKEY;
