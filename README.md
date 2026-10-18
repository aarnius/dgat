# Lankomumo žurnalas – v10 (Įrankiai)

Šaknyje: index.html, app.js, ui.js (NAUJAS), auth.js (KLIENTO), sync.js, log.js (KLIENTO), activities.js, tools.js (NAUJAS), sw.js, styles.css, manifest.json, package.json, vercel.json
api/: activities.js, auth.js (SERVERIO), admin.js, backup.js, log.js (SERVERIO), state.js, tools.js (NAUJAS)
lib/: server.js, ops.js

Ikonų (icon-*.png, favicon.*, apple-touch-icon.png) čia nėra – jos jau yra jūsų projekte, jų nekeiskite.

## Kas naujo
- Skiltis „Įrankiai“: grupių skirstymas (spausdinimas, išsaugojimas), atsitiktinis mokinio traukimas, sąrašai spausdinimui, rizikos sąrašas, dublikatų paieška ir sujungimas.
- Nauji leidimai (skiltyje „Rolės“): `tools.view`, `tools.save`. Esamoms rolėms jie suteikiami automatiškai vieną kartą (tools.view – turinčioms „Matyti lankomumą“, tools.save – turinčioms „Žymėti lankomumą“). Dublikatų sujungimui papildomai reikia „Redaguoti“ ir „Ištrinti mokinius“ bei prieigos prie visų komitetų.
- Paieškos juosta: šoninėje juostoje (visi mokiniai, atidaro kortelę) ir sąrašuose (lankomumas, ataskaitos, veiklos, dalyvių parinkimas, įrankiai).
- Visi patvirtinimo / įvedimo langai dabar rodomi programos viduje (vietoj naršyklės langų).
- Greitesnis krovimas: serveris nebekartoja viso duomenų bazės schemos tikrinimo kiekvieno paleidimo metu (`SCHEMA_V` faile lib/server.js), veiklos kraunamos lygiagrečiai, šriftas nebeblokuoja puslapio.
