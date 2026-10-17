# Attendance Tracker

A modern attendance app: dashboard, classes, students, daily attendance (Present / Absent / Late / Excused), reports with CSV export, backup/restore, light and dark themes, and student import from CSV/TSV files or pasted spreadsheet rows.

No build step and no server. It is just three static files (`index.html`, `styles.css`, `app.js`), so Vercel can host it as-is.

Data is stored in the browser (localStorage) on the device you use. Use the **Data** tab to download a backup.

## Deploy to Vercel (via GitHub, about 5 minutes)

1. Create a free account at https://github.com and make a **new repository** (any name, e.g. `attendance-tracker`).
2. On the repository page click **Add file > Upload files**, drag in `index.html`, `styles.css` and `app.js` (the files themselves, not a folder), and click **Commit changes**.
3. Go to https://vercel.com, sign up with GitHub, click **Add New > Project**, and **Import** your repository.
4. Leave every setting as it is (Framework Preset: **Other**, no build command) and click **Deploy**.
5. Vercel gives you a link like `https://attendance-tracker-xyz.vercel.app`. Open it on any device.

Every time you change a file in GitHub, Vercel redeploys automatically.

## Alternative: Vercel CLI

```
npm i -g vercel
cd attendance-tracker
vercel
```

## Limits of this version

- Data lives in one browser on one device. It is not shared between phones/computers or between teachers.
- There are no accounts or logins.
- To get shared data and logins you need a database and authentication (for example Vercel + a Postgres database and a login library). That is a bigger build, and this app's structure is easy to extend toward it.
