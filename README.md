# Lankomumo žurnalas (Attendance Tracker)

Attendance app in Lithuanian with login, users, roles and permissions. Data is saved on the server (Vercel + Neon Postgres) automatically after every change, so every teacher sees the same classes, students and attendance on any device.

## Project layout

```
index.html  styles.css  auth.js  sync.js  app.js    the website
api/auth.js  api/admin.js  api/state.js               serverless functions (login, users/roles, data)
lib/server.js                                         shared server code
package.json                                          dependency: @neondatabase/serverless
```

## Deploy (GitHub + Vercel)

1. Put **all of these files and folders** in your GitHub repository (replace the old ones). Keep the `api` and `lib` folders as folders. On GitHub: **Add file > Upload files**, drag everything in (folders included) and commit.
2. In Vercel open your project, go to **Storage**, choose **Browse Marketplace**, add **Neon Postgres**, and connect it to this project. Vercel adds `DATABASE_URL` for you (check under **Settings > Environment Variables**).
3. Still in **Settings > Environment Variables**, add `SESSION_SECRET` with a long random value (at least 32 characters; generate one with `openssl rand -base64 32` or a password generator). Keep it secret.
4. **Redeploy** (Deployments > the latest one > Redeploy) so the new variables take effect.
5. Open the site. The first visitor creates the **superadministrator** account. Tables are created automatically.

Optional: in **Settings > Functions** choose a region close to your Neon database (for example Frankfurt) to make saving faster.

## How it works

- **Saving:** after each change the browser sends only what changed (a few hundred milliseconds later). A small badge at the top right shows *Saugoma…* / *Išsaugota ✓*. If the connection drops it retries every 5 seconds, and the browser warns before you close the tab with unsaved changes.
- **Sharing:** the app checks the server every 20 seconds (and when you return to the tab) for changes made by others. Two people editing the same attendance cell at the same moment: the last save wins for that one cell, nothing else is overwritten.
- **Old browser data:** if the browser still holds data from the old no-server version, the superadmin is asked once after login whether to upload it.
- **Users and roles:** *Vartotojai* tab for users, *Rolės* tab for the permission matrix. Superadmin always has every permission. Add your own with **Naujas leidimas** and check it in code with `Auth.can('custom.your.key')`; for server-side checks use `can(user, 'custom.your.key')` from `lib/server.js`.

## Security notes

- Passwords are hashed with scrypt on the server. Sessions are signed, HttpOnly, Secure cookies. Permissions are checked on the server for every save, user change and role change, so hiding a button in the browser is never the only protection.
- After 5 wrong passwords for a username, that username is locked for 60 seconds.
- Anyone who can manage roles (`roles.manage`) can give their own role more permissions, so give it only to people you trust as administrators. Only a superadmin can create or change superadmins.
- Use a strong `SESSION_SECRET`. Changing it logs everyone out.
