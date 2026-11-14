VELQOZA AI -- merged local version

This ZIP contains your uploaded server/.env and local SQLite database.
DO NOT publish or send this ZIP to anyone. Do not push it to GitHub.
Unzip to a new folder, then double-click START-VELQOZA.cmd.
If npm is installed and the startup succeeds, open http://localhost:5173 .

This version combines your existing Email Verification/Admin/Credits project
with the App.tsx + api.ts Login Persistence Fix.

SQLite database was backed up with its WAL changes merged and integrity checked.
Your saved sessions may still need signing in again if JWT_SECRET
or origin differs from the old version.

Security: The submitted ZIP included private credentials. Rotate API
keys if they were ever shared outside your secure environment.
Do not publish this SQLite-based build for paying users.
