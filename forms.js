/* Dokumentų blankai (priėmimo, grįžimo, išėjimo, pašalinimo, pokalbio lapai).
   Tekstai redaguojami skiltyje Įrankiai → Dokumentai ir saugomi serveryje; čia – numatytieji tekstai ir formatavimas.
   Tekstų žymėjimas: "## " pavadinimas, "### " paantraštė, "# " skyrius, "- " punktas, "~ " parašo eilutė, "^ " centruota eilutė, "---" naujas lapas, **paryškinta**.
   Kintamieji: {vardas} {pavarde_vardas} {klase} {komitetai} {el_pastas} {lankomumas} {data} {data_iso} {taryba} {pirmininkas} {rengejas}. Nežinoma reikšmė paliekama kaip ______ (užpildoma ranka). */
const Forms = (() => {
  const LINE = '_'.repeat(78);
  const DOCS = [['join', 'Priėmimo lapas'], ['rejoin', 'Grįžimo (priėmimo atgal) lapas'], ['leave', 'Išėjimo lapas'], ['remove', 'Pašalinimo (išmetimo) lapas'], ['talk', 'Pokalbio lapas']];
  const WHO = `Narys: **{vardas}**
Klasė: **{klase}**
Komitetas (-ai): **{komitetai}**
El. paštas: **{el_pastas}**`;
  const DEFAULTS = {
    org: 'Kauno Stepono Dariaus ir Stasio Girėno gimnazijos Mokinių taryba',
    join: `## {taryba}
### Priėmimo į tarybą lapas ir nario įsipareigojimas
^ {data_iso}   Nr. ____________
^ Kaunas

${WHO}
Priėmimo data: **{data}**

# 1. Nario pareigos
- Aktyviai dalyvauti tarybos ir savo komiteto veikloje bei organizuojamuose renginiuose.
- Atlikti komiteto vadovo ar tarybos pirmininko pavestas užduotis sutartu laiku ir kokybiškai.
- Atstovauti mokinių interesams, sąžiningai ir pagarbiai bendrauti su mokiniais, mokytojais ir administracija.
- Gerbti kitų narių nuomonę, laikytis bendradarbiavimo ir etikos principų.
- Saugoti tarybos turtą ir konfidencialią informaciją, su kuria susipažįstama einant pareigas.
- Iš anksto informuoti komiteto vadovą, jei negali atlikti užduoties ar dalyvauti veikloje.

# 2. Dalyvavimo susirinkimuose taisyklės
- Narys privalo dalyvauti tarybos ir savo komiteto susirinkimuose bei renginiuose, kuriems yra paskirtas.
- Į susirinkimą atvykstama laiku. Vėlavimas pažymimas lankomumo žurnale.
- Apie negalėjimą dalyvauti pranešama iš anksto, ne vėliau kaip iki susirinkimo pradžios, komiteto vadovui ar pirmininkui. Pateisinta priežastis nelaikoma praleidimu.
- Nepateisintas nedalyvavimas fiksuojamas ir įskaičiuojamas į lankomumo rodiklį. Pateisintos dienos į rodiklį neįskaičiuojamos.
- Jei lankomumo rodiklis nukrenta žemiau tarybos nustatytos ribos, narys gauna žodinį, o pakartotinai – raštišką įspėjimą ir kviečiamas į pokalbį.
- Susirinkimų metu laikomasi tvarkos: telefonai nutildomi, kitam kalbant netrukdoma.

# 3. Įsipareigojimas
Pasirašydamas (-a) šį lapą patvirtinu, kad susipažinau su organizacijos „{taryba}“ nuostatais (įstatais), nario pareigomis ir dalyvavimo susirinkimuose taisyklėmis ir įsipareigoju jų laikytis. Žinau, kad nesilaikant įstatų ar šių taisyklių galiu būti įspėtas (-a) arba pašalintas (-a) iš tarybos.

# 4. Asmens duomenys
Sutinku, kad mano vardas, pavardė, klasė, el. paštas, nuotrauka ir lankomumo duomenys būtų tvarkomi tarybos lankomumo sistemoje tarybos veiklai organizuoti pagal sistemoje skelbiamą privatumo politiką.

~ Narys (-ė) {vardas}, parašas
~ Tarybos pirmininkas (-ė) {pirmininkas}, parašas`,
    rejoin: `## {taryba}
### Grįžimo į tarybą (priėmimo atgal) lapas
^ {data_iso}   Nr. ____________
^ Kaunas

${WHO}
Prašymo data: **{data}**

# 1. Grįžimo aplinkybės
Buvau tarybos nariu iki: ______________________
Išėjimo (pašalinimo) priežastis: ${'_'.repeat(48)}
Grįžti noriu, nes: ${LINE}
${LINE}

# 2. Sąlygos grįžus
- Grįžęs (-usi) narys atlieka bandomąjį laikotarpį, kurį nustato tarybos pirmininkas (iki ______ mėn.).
- Bandomuoju laikotarpiu narys privalo dalyvauti visuose jam paskirtuose susirinkimuose ir renginiuose; nedalyvavimas turi būti pateisintas iš anksto.
- Narys iš naujo susipažįsta su nario pareigomis ir dalyvavimo susirinkimuose taisyklėmis (žr. priėmimo lapą) ir įsipareigoja jų laikytis.
- Pasibaigus bandomajam laikotarpiui tarybos pirmininkas kartu su komiteto vadovu įvertina nario aktyvumą ir informuoja jį apie sprendimą.

# 3. Įsipareigojimas
Pasirašydamas (-a) šį lapą patvirtinu, kad noriu grįžti į organizaciją „{taryba}“, susipažinau su jos nuostatais (įstatais) ir taisyklėmis bei įsipareigoju jų laikytis.

# 4. Tarybos sprendimas
Sprendimas: ☐ priimti  ☐ priimti su bandomuoju laikotarpiu  ☐ nepriimti
Pastabos: ${LINE}

~ Narys (-ė) {vardas}, parašas
~ Tarybos pirmininkas (-ė) {pirmininkas}, parašas`,
    leave: `## {taryba}
### Išėjimo iš tarybos lapas
^ {data_iso}   Nr. ____________
^ Kaunas

${WHO}
Prašymo data: **{data}**

# 1. Prašymas
Prašau atleisti mane iš organizacijos „{taryba}“ nario pareigų nuo: ______________________
Išėjimo priežastis (nebūtina nurodyti): ${LINE}

# 2. Pareigų ir turto perdavimas
- Perduodu savo užduotis, medžiagą ir tarybos turtą (nurodyti): ${LINE}
- Patvirtinu, kad neturiu neįvykdytų įsipareigojimų tarybai arba jie išvardinti aukščiau.
- Su komiteto vadovu dėl užduočių perdavimo susitarta: ☐ taip  ☐ ne

# 3. Asmens duomenys
Žinau, kad mano lankomumo duomenys sistemoje saugomi pagal privatumo politiką ir kad turiu teisę prašyti juos ištrinti.
☐ Prašau ištrinti mano asmens duomenis iš sistemos
☐ Sutinku, kad duomenys būtų saugomi iki nustatyto saugojimo termino pabaigos

# 4. Pareiškimas
Dėkoju už galimybę dalyvauti tarybos veikloje.

~ Narys (-ė) {vardas}, parašas
~ Tarybos pirmininkas (-ė) {pirmininkas}, parašas`,
    remove: `## {taryba}
### Nario pašalinimo iš tarybos lapas
^ {data_iso}   Nr. ____________
^ Kaunas

${WHO}
Lankomumo rodiklis: **{lankomumas}**
Pašalinimo data: **{data}**

# 1. Pašalinimo pagrindas
☐ Pakartotinis nepateisintas nedalyvavimas susirinkimuose ar renginiuose
☐ Tarybos įstatų ar nario pareigų pažeidimas
☐ Etikos ar elgesio taisyklių pažeidimas
☐ Kita: ${'_'.repeat(52)}
Aprašymas: ${LINE}
${LINE}

# 2. Taikytos priemonės
- Žodinis įspėjimas duotas (data): ______________________
- Raštiškas įspėjimas duotas (data): ______________________
- Pokalbis su nariu vyko (data): ______________________

# 3. Sprendimas
Sprendimas priimtas tarybos susirinkime (data, protokolo Nr.): ${'_'.repeat(40)}
Balsavimo rezultatas (už / prieš / susilaikė): ______ / ______ / ______
Narys pašalinamas iš tarybos nuo: ______________________

# 4. Nario teisės
Narys su sprendimu supažindintas. Per 5 darbo dienas jis turi teisę pateikti raštišką paaiškinimą ar prašymą sprendimą peržiūrėti tarybos pirmininkui arba gimnazijos administracijai. Narys privalo perduoti tarybos turtą ir pradėtas užduotis.
Nario paaiškinimas (nebūtina): ${LINE}

~ Tarybos pirmininkas (-ė) {pirmininkas}, parašas
~ Tarybos sekretorius (-ė), parašas
~ Susipažinau. Narys (-ė) {vardas}, parašas`,
    talk: `## {taryba}
### Motyvacinio pokalbio lapas
^ {data_iso}   Nr. ____________
^ Kaunas

${WHO}
Lankomumo rodiklis: **{lankomumas}**
Pokalbio data: **{data}**
Pokalbį vedė: ${'_'.repeat(50)}
Dalyvavo: ${'_'.repeat(54)}

# 1. Pokalbio priežastis
☐ Žemas lankomumas / dažni praleidimai
☐ Sumažėjęs aktyvumas ar įsitraukimas
☐ Neatliktos pavestos užduotys
☐ Kita: ${'_'.repeat(52)}
Praleisti susirinkimai (datos, skaičius): ${LINE}

# 2. Nario požiūris
Kodėl, nario manymu, taip nutiko? Kas trukdo dalyvauti?
${LINE}
${LINE}
Kas jam patinka tarybos veikloje, kokia veikla jam įdomiausia?
${LINE}

# 3. Susitarimai
Ką narys įsipareigoja daryti (konkrečiai ir su terminais):
${LINE}
${LINE}
Kokios pagalbos narys tikisi iš tarybos (užduočių keitimas, kitas komitetas, laikas, kt.):
${LINE}

# 4. Tolesni žingsniai
Kitas pokalbis / susitarimų peržiūra (data): ______________________
Jei situacija nesikeičia, narys gauna raštišką įspėjimą ir kviečiamas į pakartotinį pokalbį; toliau gali būti svarstomas klausimas dėl narystės tęsimo.

~ Narys (-ė) {vardas}, parašas
~ Pokalbį vedęs (-usi) asmuo, parašas`,
  };

  let saved = {};
  const set = (f) => { saved = f && typeof f === 'object' ? f : {}; };
  const text = (k) => (typeof saved[k] === 'string' && saved[k].trim() ? saved[k] : DEFAULTS[k]);
  const org = () => (typeof saved.org === 'string' && saved.org.trim() ? saved.org.trim() : DEFAULTS.org);
  const chair = () => (typeof saved.chair === 'string' ? saved.chair.trim() : '');
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
