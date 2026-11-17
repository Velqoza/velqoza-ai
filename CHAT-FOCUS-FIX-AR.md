# VELQOZA AI — Chat Composer Focus Fix

- AI Studio input keeps keyboard focus after sending, even when AI is answering.
- Input remains editable while a reply is pending; send is blocked until the pending response completes.
- Draft typed while waiting is preserved if request fails.
- Website Editor chat input also keeps focus after sending and after completion.
- Enter sends; Shift+Enter adds a newline. IME composition is respected.

## Safe update

The fix only changes `client/src/App.tsx`. To avoid changing your account, database, API key, or env configuration, copy **only that file** into your installed VELQOZA AI at `client/src/App.tsx`, replacing its existing file (make a backup first). Restart `npm.cmd run dev` if needed.

If you have made additional modifications to App.tsx since the Studio Chat Fix version, do not overwrite blindly; merge the small changes instead.
