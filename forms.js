/* Dokumentų blankai (priėmimo, grįžimo, išėjimo, pašalinimo, pokalbio lapai).
   Tekstai redaguojami skiltyje Įrankiai → Dokumentai ir saugomi serveryje; čia – numatytieji tekstai ir formatavimas.
   Tekstų žymėjimas: "## " pavadinimas, "### " paantraštė, "# " skyrius, "- " punktas, "~ " parašo eilutė, "^ " centruota eilutė, "---" naujas lapas, **paryškinta**.
   Kintamieji: {vardas} {pavarde_vardas} {klase} {komitetai} {el_pastas} {lankomumas} {data} {data_iso} {taryba} {pirmininkas} {rengejas}. Nežinoma reikšmė paliekama kaip ______ (užpildoma ranka). */
const Forms = (() => {
  const LINE = '_'.repeat(78);
  const DOCS = [['join', 'Priėmimo lapas'], ['rejoin', 'Grįžimo (priėmimo atgal) lapas'], ['leave', 'Išėjimo lapas'], ['warn', 'Įspėjimo lapas'], ['remove', 'Pašalinimo lapas'], ['talk', 'Pokalbio lapas']];
  const WHO = `Narys: **{vardas}**
Klasė: **{klase}**
Komitetas (-ai): **{komitetai}**
El. paštas: **{el_pastas}**`;
  const HEAD = (title) => `## {taryba}
### ${title}
^ {data_iso}   Nr. ____________
^ Kaunas
`;
  const DEFAULTS = {
    org: 'Kauno Stepono Dariaus ir Stasio Girėno gimnazijos mokinių taryba',
    chair: 'Arnas Vojevudskas',
    join: `${HEAD('Priėmimo į Tarybą lapas ir nario įsipareigojimas')}
${WHO}
Priėmimo data: **{data}**

# 1. Priėmimas (įstatų 5.1 p.)
Kandidatas sėkmingai įveikė atranką: ☐ komandinio formavimo užduotys  ☐ motyvacinis pokalbis  ☐ bendra komandos formavimo užduotis  ☐ baigiamasis etapas
Sprendimą dėl priėmimo priėmė Tarybos vadovybė: ☐ priimti  ☐ nepriimti

# 2. Nario pareigos (įstatų 5.3 p.)
- Laikytis Tarybos įstatų ir gimnazijos vidaus tvarkos taisyklių.
- Dalyvauti Tarybos posėdžiuose, o negalint dalyvauti – iš anksto informuoti pirmininką arba sekretorių.
- Atsakingai ir laiku atlikti pavestas užduotis; aktyviai dalyvauti savo komiteto veikloje.
- Gerbti kitus narius ir mokyklos bendruomenę, savo elgesiu nemenkinti Tarybos vardo.
- Neviešinti Tarybos vidinės informacijos, kuri nėra skirta viešinti.

# 3. Dalyvavimas ir pasekmės (įstatų IV ir VI sk.)
- Taryba renkasi ne rečiau kaip kartą per mėnesį; apie posėdį informuojama ne vėliau kaip prieš 3 dienas.
- Įspėjimas skiriamas, jei narys be pateisinamos priežasties praleidžia 2 posėdžius iš eilės, nevykdo pareigų arba netinkamai elgiasi. Pateisinamos priežastys: liga, olimpiados, varžybos ar kiti mokyklos renginiai, šeimos aplinkybės, apie kurias iš anksto informuota vadovybė.
- Įspėjimai galioja iki mokslo metų pabaigos. Paskyrus 2 galiojančius įspėjimus narys šalinamas iš Tarybos; už šiurkštų pažeidimą gali būti pašalintas ir be įspėjimų. Pašalintas narys iš naujo nepriimamas.

# 4. Įsipareigojimas
Pasirašydamas (-a) patvirtinu, kad susipažinau su Tarybos įstatais, savo teisėmis ir pareigomis, savanoriškai tampu Tarybos nariu ir įsipareigoju laikytis įstatų. Sutinku, kad mano vardas, pavardė, klasė, el. paštas, nuotrauka ir lankomumo duomenys būtų tvarkomi Tarybos lankomumo sistemoje Tarybos veiklai organizuoti pagal skelbiamą privatumo politiką.

~ Narys (-ė) {vardas}, parašas
~ Tarybos pirmininkas (-ė) {pirmininkas}, parašas`,
    rejoin: `${HEAD('Grįžimo į Tarybą (priėmimo atgal) lapas')}
${WHO}
Prašymo data: **{data}**

# 1. Grįžimo aplinkybės
Taryboje buvau iki: ______________________
Išėjimo priežastis: ${'_'.repeat(52)}
Grįžti noriu, nes: ${'_'.repeat(54)}
${'_'.repeat(78)}
Pažymėtina: iš Tarybos pašalintas narys iš naujo nepriimamas (įstatų 6.3.6 p.). Šis lapas skirtas savo noru išstojusiems nariams.

# 2. Sąlygos grįžus
- Grįžęs (-usi) narys iš naujo susipažįsta su Tarybos įstatais, savo teisėmis ir pareigomis (įstatų 5.2, 5.3 p.) ir įsipareigoja jų laikytis.
- Dėl grįžimo sprendžia Tarybos vadovybė. Atrankos tvarka ir bandomasis laikotarpis nustatomi pagal vadovybės sprendimą: ______________________

# 3. Įsipareigojimas
Pasirašydamas (-a) patvirtinu, kad noriu grįžti į Tarybą, susipažinau su Tarybos įstatais ir įsipareigoju jų laikytis.

# 4. Tarybos vadovybės sprendimas
☐ priimti  ☐ priimti su sąlygomis: ${'_'.repeat(40)}  ☐ nepriimti
Pastabos: ${'_'.repeat(66)}

~ Narys (-ė) {vardas}, parašas
~ Tarybos pirmininkas (-ė) {pirmininkas}, parašas`,
    leave: `${HEAD('Išėjimo iš Tarybos lapas')}
${WHO}
Pranešimo data: **{data}**

# 1. Pranešimas apie išstojimą (įstatų 5.4 p.)
Informuoju Tarybos ☐ pirmininką  ☐ sekretorių, kad savo noru išstoju iš Tarybos nuo: ______________________
Priežastis (nebūtina nurodyti): ${'_'.repeat(48)}

# 2. Darbų, dokumentų ir prieigų perdavimas
Perduodu komiteto koordinatoriui arba vadovybei turimus darbus, dokumentus ir prieigas (pvz., prie socialinių tinklų paskyrų):
${'_'.repeat(78)}
${'_'.repeat(78)}
Perdavimą priėmė (vardas, pavardė): ${'_'.repeat(44)}

# 3. Asmens duomenys
Žinau, kad mano lankomumo duomenys sistemoje saugomi pagal privatumo politiką ir kad turiu teisę prašyti juos ištrinti.
☐ Prašau ištrinti mano asmens duomenis iš sistemos
☐ Sutinku, kad duomenys būtų saugomi iki nustatyto saugojimo termino pabaigos

~ Narys (-ė) {vardas}, parašas
~ Tarybos pirmininkas (-ė) {pirmininkas} arba sekretorius (-ė), parašas`,
    warn: `${HEAD('Įspėjimo Tarybos nariui lapas')}
${WHO}
Įspėjimo data: **{data}**

# 1. Įspėjimo priežastis (įstatų 6.1.1 p.)
☐ Be pateisinamos priežasties praleisti 2 posėdžiai iš eilės (datos): ${'_'.repeat(30)}
☐ Nevykdomos pareigos – neatliktos užduotys ar nesilaikoma terminų: ${'_'.repeat(20)}
☐ Netinkamas elgesys: ${'_'.repeat(54)}
Aprašymas: ${'_'.repeat(64)}
${'_'.repeat(78)}

# 2. Nario paaiškinimas (įstatų 5.2.5, 6.1.3 p.)
Vadovybė išklausė nario paaiškinimą: ☐ taip  ☐ narys atsisakė pateikti
Paaiškinimas: ${'_'.repeat(60)}
${'_'.repeat(78)}

# 3. Sprendimas
Skiriamas įspėjimas, galiojantis iki einamųjų mokslo metų pabaigos (data): ______________________
Galiojančių įspėjimų skaičius su šiuo: ______ (paskyrus 2 galiojančius įspėjimus, narys šalinamas, įstatų 6.2.1 p.).
Įspėjimas įrašytas į įspėjimų registrą, Nr. ______ . Narys informuotas raštu: ☐ žinute  ☐ el. laišku  ☐ šiuo lapu

~ Tarybos pirmininkas (-ė) {pirmininkas}, parašas
~ Tarybos sekretorius (-ė), parašas
~ Susipažinau. Narys (-ė) {vardas}, parašas`,
    remove: `${HEAD('Nario pašalinimo iš Tarybos lapas')}
${WHO}
Lankomumo rodiklis: **{lankomumas}**
Sprendimo data: **{data}**

# 1. Pašalinimo pagrindas (įstatų 6.2 p.)
☐ Paskirti 2 galiojantys įspėjimai (registro Nr.: ____________, ____________)
☐ Šiurkštus pažeidimas: ☐ smurtas  ☐ tyčiojimasis  ☐ diskriminacija  ☐ viešas Tarybos ar gimnazijos vardo menkinimas  ☐ piktnaudžiavimas Tarybos lėšomis, turtu ar paskyromis
Aprašymas: ${'_'.repeat(64)}
${'_'.repeat(78)}

# 2. Sprendimas (įstatų 6.3 p.)
Nario paaiškinimas išklausytas: ☐ taip  ☐ narys atsisakė pateikti
Sprendimą priėmė: ☐ Tarybos vadovybė (pirmininkas, pavaduotojas, sekretorius)  ☐ visa Taryba 2/3 balsų (kai šalinamas vadovybės narys)
Balsavimo rezultatas (už / prieš / susilaikė): ______ / ______ / ______
Protokolo Nr.: ______________  Narys pašalinamas nuo: ______________________

# 3. Nario informavimas ir perdavimas
- Narys apie sprendimą ir jo priežastis informuotas raštu (įstatų 6.3.4 p.): ☐ žinute  ☐ el. laišku  ☐ šiuo lapu
- Per 3 darbo dienas narys perduoda turimus Tarybos darbus, dokumentus ir prieigas (įstatų 6.3.5 p.).
- Pašalintas narys iš naujo į Tarybą nepriimamas (įstatų 6.3.6 p.).

~ Tarybos pirmininkas (-ė) {pirmininkas}, parašas
~ Tarybos pirmininko pavaduotojas (-a), parašas
~ Tarybos sekretorius (-ė), parašas
~ Susipažinau. Narys (-ė) {vardas}, parašas`,
    talk: `${HEAD('Motyvacinio pokalbio lapas')}
${WHO}
Lankomumo rodiklis: **{lankomumas}**
Pokalbio data: **{data}**
Pokalbį vedė: ${'_'.repeat(50)}
Dalyvavo: ${'_'.repeat(54)}

# 1. Pokalbio priežastis
☐ Žemas lankomumas / praleisti posėdžiai
☐ Sumažėjęs aktyvumas ar įsitraukimas
☐ Neatliktos pavestos užduotys
☐ Kita: ${'_'.repeat(52)}
Praleisti posėdžiai (datos, skaičius): ${'_'.repeat(40)}

# 2. Nario požiūris
Kodėl, nario manymu, taip nutiko? Kas trukdo dalyvauti? Kokia veikla jam įdomiausia?
${'_'.repeat(78)}
${'_'.repeat(78)}

# 3. Susitarimai
Ką narys įsipareigoja daryti (konkrečiai, su terminais) ir kokios pagalbos tikisi (užduočių keitimas, kitas komitetas, laikas, kt.):
${'_'.repeat(78)}
${'_'.repeat(78)}

# 4. Tolesni žingsniai
Susitarimų peržiūros data: ______________________
Pokalbis yra prevencinė priemonė ir įspėjimas nėra skiriamas. Jei situacija nesikeičia, gali būti skiriamas įspėjimas pagal įstatų 6.1 p. (2 posėdžių iš eilės praleidimas be pateisinamos priežasties, pareigų nevykdymas ar netinkamas elgesys).

~ Narys (-ė) {vardas}, parašas
~ Pokalbį vedęs (-usi) asmuo, parašas`,
  };

  let saved = {};
  const set = (f) => { saved = f && typeof f === 'object' ? f : {}; };
  const text = (k) => (typeof saved[k] === 'string' && saved[k].trim() ? saved[k] : DEFAULTS[k]);
  const org = () => (typeof saved.org === 'string' && saved.org.trim() ? saved.org.trim() : DEFAULTS.org);
  const chair = () => (typeof saved.chair === 'string' && saved.chair.trim() ? saved.chair.trim() : DEFAULTS.chair);
  const isCustom = (k) => typeof saved[k] === 'string' && saved[k].trim() && saved[k] !== DEFAULTS[k];

  const MONTHS = ['sausio', 'vasario', 'kovo', 'balandžio', 'gegužės', 'birželio', 'liepos', 'rugpjūčio', 'rugsėjo', 'spalio', 'lapkričio', 'gruodžio'];
  const dateLong = (iso) => { const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(iso || ''); return m ? `${m[1]} m. ${MONTHS[+m[2] - 1]} ${+m[3]} d.` : ''; };
  const BLANK = '______________';
  const stamp = () => { const n = new Date(), p = (x) => String(x).padStart(2, '0'); return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())} ${p(n.getHours())}:${p(n.getMinutes())}`; };

  /* Kintamųjų reikšmės vienam mokiniui (arba tuščias blankas, kai s == null). */
  function vars(s, o) {
    const v = (x) => (x ? String(x) : BLANK);
    return {
      vardas: s ? v([s.first, s.last].filter(Boolean).join(' ')) : BLANK.repeat(2),
      pavarde_vardas: s ? v([s.last, s.first].filter(Boolean).join(' ')) : BLANK.repeat(2),
      klase: v(s && s.grade), komitetai: v(s && o.coms), el_pastas: v(s && s.email),
      lankomumas: s && o.rate != null ? o.rate + ' %' : BLANK, data: v(dateLong(o.date)), data_iso: v(o.date), taryba: org(),
      pirmininkas: chair() || BLANK, rengejas: o.author || BLANK,
    };
  }
  const fill = (t, vs) => t.replace(/\{(\w+)\}/g, (m, k) => (k in vs ? vs[k] : m));

  /* Tekstas → blokai (bendri .docx ir ekrano / spausdinimo vaizdui). */
  function blocks(key, s, o) {
    const vs = vars(s, o), out = [];
    fill(text(key), vs).split(/\r?\n/).forEach((raw) => {
      const l = raw.replace(/\s+$/, '');
      if (!l.trim()) return;
      if (l === '---') out.push({ t: 'pb' });
      else if (l.startsWith('### ')) out.push({ t: 'sub', text: l.slice(4).toLocaleUpperCase('lt') });
      else if (l.startsWith('## ')) out.push({ t: 'title', text: l.slice(3).toLocaleUpperCase('lt') });
      else if (l.startsWith('# ')) out.push({ t: 'h', text: l.slice(2) });
      else if (l.startsWith('- ')) out.push({ t: 'li', text: l.slice(2) });
      else if (l.startsWith('~ ')) out.push({ t: 'sig', text: l.slice(2) });
      else if (l.startsWith('^ ')) out.push({ t: 'c', text: l.slice(2) });
      else out.push({ t: 'p', text: l });
    });
    if (o.author) out.push({ t: 'note', text: 'Dokumentą parengė: ' + o.author + ', ' + stamp() });
    return out;
  }
  const label = (k) => (DOCS.find((d) => d[0] === k) || [0, k])[1];

  /* Keli mokiniai → vienas dokumentas, kiekvienas naujame lape. */
  function many(key, list, o) {
    const all = [];
    (list.length ? list : [null]).forEach((s, i) => {
      if (i) all.push({ t: 'pb' });
      all.push(...blocks(key, s, s ? o(s) : o(null)));
    });
    return all;
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const inline = (t) => esc(t).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  function html(bl) {
    let out = '<section class="form-sheet">';
    bl.forEach((b) => {
      if (b.t === 'pb') out += '</section><section class="form-sheet">';
      else if (b.t === 'title') out += `<h1 class="f-title">${inline(b.text)}</h1>`;
      else if (b.t === 'c') out += `<p class="f-c">${inline(b.text)}</p>`;
      else if (b.t === 'sub') out += `<p class="f-sub">${inline(b.text)}</p>`;
      else if (b.t === 'h') out += `<h2 class="f-h">${inline(b.text)}</h2>`;
      else if (b.t === 'li') out += `<p class="f-li">${inline(b.text)}</p>`;
      else if (b.t === 'sig') out += `<p class="f-sig">${inline(b.text)} <span class="f-fill"></span></p>`;
      else if (b.t === 'note') out += `<p class="f-note">${inline(b.text)}</p>`;
      else out += `<p>${inline(b.text)}</p>`;
    });
    return out + '</section>';
  }

  return { DOCS, DEFAULTS, set, text, org, chair, isCustom, label, blocks, many, html, dateLong };
})();
