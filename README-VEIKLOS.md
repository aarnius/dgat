# Veiklos – diegimas

Failų išdėstymas (kaip jūsų projekte):

- `api/activities.js` – NAUJAS
- `api/log.js` – pakeistas (nauji LOG įvykiai)
- `lib/server.js`, `lib/ops.js` – pakeisti
- `activities.js` – NAUJAS (kliento modulis)
- `index.html`, `app.js`, `auth.js`, `sync.js`, `log.js`, `sw.js`, `styles.css` – pakeisti (`log.js` šaknyje = kliento LOG; `api/log.js` = serverio)

Naujų aplinkos kintamųjų nereikia. Lentelės Neon bazėje susikuria pačios pirmo užklausos metu.

Po įkėlimo: Rolės → pažymėkite naujus leidimus (grupė „Veiklos“ ir „Žymėti dienos lankomumą be veiklos“).
Esamos rolės su „Žymėti lankomumą“ automatiškai gauna „Žymėti dienos lankomumą be veiklos“, „Žymėti lankomumą veiklų užsiėmimuose“
ir „Matyti veiklas“ (kad niekas nenustotų dirbti). Norėdami priversti žymėti tik per veiklas – nuimkite „be veiklos“ leidimą.
