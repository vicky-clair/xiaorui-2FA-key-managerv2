# Security Policy

## Red Lines
As explicitly defined in the project architecture document, the following operations are strictly forbidden:

1. Never upload the TOTP Secret to the server.
2. Never write the Master Password to logs.
3. Never upload the Vault in plaintext.
4. Never store License Private Keys on the client.
5. Browser Extensions must not read the database directly.
6. Do not store the long-term Vault Key in React State.
7. Do not store Secrets in `localStorage`.
8. Do not store the Master Password in `AsyncStorage` or `SecureStore`.
9. Never use `eval()` or dynamic code execution on user input or scanned QR codes.

All code contributions MUST adhere to these strict security limits.
