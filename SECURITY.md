# Security Policy

Do not report authentication material in a public issue. This reference
implementation never needs a contributor's cookies, authorization headers,
account recovery data, or device credentials.

Reports should include only:

- the plugin and host commit hashes;
- Android and Grayjay versions;
- the normalized error code;
- sanitized structural command paths;
- reproduction steps that do not expose account data.

Before committing fixtures or logs, search for `Cookie`, `Authorization`,
`SAPISID`, `VISITOR_DATA`, `DATASYNC_ID`, email addresses, and channel IDs.
Replace identifiers with deterministic fixture values while preserving the
response structure required by the test.

Security reports concerning official Grayjay releases should use FUTO's
official reporting channels rather than this repository.
