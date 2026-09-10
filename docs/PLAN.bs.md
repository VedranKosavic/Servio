# Šank — plan aplikacije

*Plan od 08.09.2026., napisan za vlasnika lokala i Vedrana. Brojevi, pragovi i sati isti su kao u tehničkom planu.*

## 1. Šta je Šank i zašto ga pravimo

Danas u lokalu ništa nije zapisano po narudžbi: konobari nose gotovinu u džepu, vlasnik navečer vidi samo pazar, a stanje šanka je sveska u koju niko ne vjeruje. Vlasnik kao razloge navodi curenje robe i novca preko osoblja i lošu atmosferu — a to je jedan problem. Bez zajedničkog zapisa šta je prodano, ko je prodao, za koliko i šta je zbog toga otišlo s police, svaki manjak je optužba na osjećaj, a svaki pošten konobar sumnjiv.

Šank taj zapis pravi u trenutku kad se nešto desi i iz njega izvodi svaki broj koji vlasnik vidi. Konobar na svom telefonu zaključi turu; svaka marka i svaki gram uđu jednom, ne mogu se mijenjati i nose ime osobe i telefon s kojeg su došli. Vlasnik po smjeni vidi gotovinu i robu — prebrojano naspram očekivanog, a svaki broj o jednoj osobi ta osoba vidi prva, na svom telefonu.

Odgovornost radi samo kad je obostrana i stiže odmah. Zato krug — zaključi turu, slijepa predaja gotovine po konobaru, slijepi brzi popis dvadesetak najvrednijih artikala vaganjem, vlasnikov **"Pregled dana"** od pet minuta — dolazi do osoblja već poslije druge faze, prije ikakvih grafikona. Aplikacija vidi samo ono što konobar dodirne, pa se zapis nadopunjuje provjerama koje se ne mogu lažirati (vaganje kafe i duhana, žar po luli, vlasnikovi nasumični popisi), a pravila koja aplikacija ne može nametnuti pišu se u **"Pravila"** unutar aplikacije.

Prioriteti: BRZO za konobara (dvije kafe u 5 dodira, naplata gotovinom u 3, žar u 2); JASNO za vlasnika (gotovina i roba, prebrojano naspram očekivanog, po smjeni); POŠTENO prema osoblju (pragovi objavljeni, "označeno za razgovor" nikad nije presuda, nema rang-liste, svako odgovara za svoju gotovinu); JEDNOSTAVNO za Vedrana. Iznad svega: unos mora biti brži od papira, inače ništa drugo neće imati podatke.

## 2. Šta Šank nije

Šank nije fiskalna kasa nego interni zapis narudžbi, smjena, robe i odgovornosti. Ne izdaje račune, ništa ne štampa, u prvoj verziji ne pravi PDF. Jedini ekran za gosta je **"Pokaži narudžbu"** na konobarovom telefonu s vodenim žigom "PREGLED NARUDŽBE · NIJE FISKALNI RAČUN · NIJE NARUDŽBENICA". Nema PDV linija, numerisanja računa ni QR kodova; riječ "račun" postoji samo u **"Na račun kuće"**.

Napomena iz jednog pregleda plana, nije provjerena: FBiH je u januaru 2026. usvojila Zakon o fiskalizaciji transakcija (na snazi od februara 2026., primjena u roku od 18 mjeseci) koji u ugostiteljstvu uređuje narudžbenicu prije računa i vodi ka e-fiskalizaciji. Hoće li i kada lokal fiskalizovati prodaju, vlasnikova je pravna odluka izvan aplikacije; Šank bilježi šta je prodano, ali to ne čini fiskalnim. Entitet odlučuje o eventualnoj integraciji (odluka 13).

## 3. Pravila lokala koja oblikuju aplikaciju

Vlasnikova četiri pravila:

1. **Roba stiže svaki dan.** Prijem robe je dnevni posao vlasnika; unose ga samo vlasnici i admini. Vlasnik slika otpremnicu, aplikacija popuni stavke, a ništa ne ulazi u stanje dok vlasnik ne dodirne **"Proknjiži"**.
2. **Više vlasnika i admina.** Svaki ima svoj nalog; svaka administratorska radnja (prijem, cijena, storno, popis, postavke, uzimanje iz kase) nosi ime i vidi se na stranici **"Dnevnik"**.
3. **Nargila se prati u gramima.** Norma je 20 g po luli, dakle 1 kg arome je 50 lula. Mjesečno: početno + primljeno − završno (izvagano) = potrošeno; potrošeno ÷ 20 = očekivane lule, naspram zaključenih. Izvagano završno stanje je početno stanje sljedećeg mjeseca.
4. **Nabavka naspram prodaje po kategoriji.** Za svaku kategoriju potrošeno na nabavku pored zarađenog; proizvodi i roba dijele jednu listu kategorija (Vedran šalje listu, odluka 15).

Vedranovih šest zahtjeva za timski dio — svi obavezni, nijedan ne smije dodati dodir u tok narudžbe:

- **Razgovor.** Tri stalna kanala: **"Admini"** (samo vlasnici), **"Konobari"** (samo osoblje; vlasnici ga u aplikaciji ne vide), **"Svi"** — za "šta treba naručiti", potvrde i slike.
- **Dnevnik.** Svaka radnja se bilježi gdje je ostali admini vide; stara "Aktivnost" i zapis radnji postaju jedno.
- **Završi smjenu.** Konobar završi smjenu; aplikacija sama ispiše promet (npr. 612,50 KM) u Dnevnik, a svaka kategorija ("Nargila 34") otvara listu stavki s vremenom zaključenja. To je proširenje postojeće predaje gotovine, ne drugi kraj smjene.
- **Slike i kamera.** Razgovor prima slike iz kamere ili galerije (lijepa kafa, nered iza prethodne smjene).
- **Raspored smjena.** Tabela koja se brzo mijenja i u kojoj osoblje samostalno zamjenjuje smjene.
- **Samo bosanski.** Nijedna engleska riječ na ekranu. Nema sloja za prevođenje — svaki natpis se piše na bosanskom direktno u kodu; i poruke na Telegram su na bosanskom. Nazivi u kodu i dokumentacija za programere ostaju engleski.

## 4. Ko koristi aplikaciju

Uloge: vlasnik/admin, šanker, konobar i "menadžer" (ograničeni admin s uvidom, bez ekrana u prvoj verziji). Osoblje se prijavljuje imenom i PIN-om na odobrenom telefonu (4 cifre konobari, 6 vlasnik i šanker); vlasnik ima i e-mail i lozinku. Niko se ne briše, samo deaktivira. Vlasnika može biti više, svaki sa svojim nalogom i Telegramom.

| | **Vlasnik / admin** — jedan ili više | **Šanker** — 0 ili 1 po smjeni | **Konobar** — 2 do 6, svoj telefon |
|---|---|---|---|
| Narudžbe | kao svi; naknadni unos s papira | narudžbe, šank, **"Priprema"** (faza 1) | uzima, zaključuje, naplaćuje; **"Žar"**; **"Premjesti sto"**; **"Predaj sto kolegi"** |
| Storno i gratis | odlučuje sve, samo sa svog uređaja; jedini odobrava "gost vlasnika" | šestocifreni PIN ili red **"Na čekanju"**, samo stavke mlađe od 15 minuta | sam stornira svoju nenaplaćenu stavku do 5 minuta; inače traži; piće za osoblje u limitu |
| Smjena | otvara, zatvara, prisilno zatvara, pregleda; polog; unos ukupnog iznosa s kartica; **"Uzeo iz kase"**; prihvata predaje u kasu | otvara i zatvara, prima gotovinu, **"Brzi popis"** na početku i kraju (čuvar robe), isplate | smjena se otvara sama prvom turom; **"Završi smjenu"** = slijepa predaja; poslije ne može ništa zaključiti |
| Roba | prijemi (ručno ili **"sa slike"**), otpis, popisi, potvrde, korekcije | otpis, brzi popis; prijem ako vlasnik uključi | otpis ispod pragova |
| Meni, ljudi, uređaji | sve; objava **"Pravila"** | ništa | svoj PIN; polje za cijenu ne postoji |
| Razgovor · Dnevnik · Raspored | **"Svi"** i **"Admini"**; Dnevnik; raspored, **"Zamjene"**, **"Sati"** | **"Svi"** i **"Konobari"**; bez Dnevnika; svoje smjene i zamjene | isto: **"Traži zamjenu"** / **"Preuzimam"** |
| Šta vidi | sve osim "Konobari" | ekran **"Moja smjena"**; iznose konobara samo dok prima gotovinu | svoje ture, storna, gratis, sate; iznose tek nakon predaje; promet lokala samo ako vlasnik uključi |

**Noći bez šankera.** Smjena se otvara sama, zadnji predaje gotovinu u kasu, a storna i gratisi ostaju "na čekanju" u konobarovom očekivanom pazaru dok vlasnik ne odluči sa svog telefona.

**"Priprema"** (faza 1): šanker vidi zaključene stavke koje nisu napravljene i označi ih jednim dodirom ("nema tikete, nema pića").

**Šta niko ne može, ni vlasnik:** izmijeniti ili obrisati zaključenu stavku, naplatu, predaju, zapis u Dnevniku ili kretanje robe; upisati nešto sa starijim datumom; ponovo otvoriti zatvorenu smjenu (može je samo označiti kao pregledanu i dodati bilješku) ili naplaćen sto; čitati "Konobari" iz aplikacije. To čuva sama baza. Zabranjeno nije sivo dugme: ekran kaže "Ovo potvrđuje šanker/vlasnik" i pokaže put, nikad "nemate pravo".

| Uloga | Svi | Konobari | Admini | Dnevnik |
|---|---|---|---|---|
| Vlasnik / admin | da | ne | da | da |
| Menadžer (faza 5) | da | ne | ne | ne |
| Šanker | da | da | ne | ne |
| Konobar | da | da | ne | ne |

Šanker je osoblje: svaku noć je na terenu s konobarima; drukčije je jedna promjena (odluka 18).

## 5. Kako radi konobar

Aplikacija je tamna, velikih slova (tekst 18 px, iznosi 24 px), glavno dugme pri dnu. Novi konobar je spreman za manje od dvije minute: instalacija, kod sa stranice **"Uređaji"**, ime, PIN, tri kartice uputstva, potvrda **"Pravila"**.

### Ekrani korak po korak

**Prijava.** PIN, potvrda sama na zadnjoj cifri; zajednički uređaj na šanku zaključava se nakon 5 minuta, a otključava PIN-om i bez mreže ako se osoba prijavila tu u zadnjih 14 sati (faza 2). Ako telefon otkaže, konobar se na kolegin telefon prijavljuje kao **"Drugi konobar"** (2 sata, zaglavlje "Amar · Emirov telefon"). Pogrešan PIN: 5 puta → 60 sekundi, 10 → 15 minuta i poruka vlasniku, 15 → uređaj zaključan.

**Stolovi.** Nacrt lokala iz ptičije perspektive, po vlasnikovoj skici: Unutra (lijeva kolona 6 stolova, srednja 4, desna 5, VIP ispod desne s 2 stola) i Bašta (lijeva kolona 7 stolova, desna 3, poravnata sa sredinom lijeve), prekidač Unutra | Bašta; dodir na sto otvara narudžbu. Sto je slobodan, moj ("24,50 KM", "12 min"), kolegin (inicijali), naplata čeka slanje (žuto), nacrt ("nacrt 3 · 8,50") ili ponuđen ("Nudi ti: Sto 7" → **"Prihvati"**). Zaglavlje: **"Samo moji"**, oznaka veze (zelena "Sinhronizovano", žuta "Čeka slanje (2)", crvena "Nema veze — narudžbe se čuvaju"), "Nacrti (2)" i avatar s menijem **"Razgovor (3) · Raspored · Moja smjena · Završi smjenu · Pravila · Drži ekran upaljen · Odjavi se"**. Dugme **"+ Bez stola"** za narudžbu bez stola (faza 2).

**Nova tura.** Dodir na Sto 7 → meni s oznakom "Sto 7 · Unutra" (zauzet sto: **"+ Dodaj"**). Kafa dva puta (brojač 2), Coca-Cola; traka "3 stavke · 12,50 KM · Pregled · Zaključi". Dugi pritisak: brze napomene (bez šećera · s mlijekom · dupla), tekst ili **"Na račun kuće"**. Nacrt stariji od 15 minuta pulsira "Sto 7: nacrt čeka — Zaključi?". Meni **"⋯"** na stolu: **"Nije plaćeno · Premjesti sto · Predaj sto kolegi · Pokaži narudžbu"** (ekran za gosta s vodenim žigom).

**Zaključi.** **"Zaključi (3) · 8,50 KM"** → lista i ukupno → **"Potvrdi"**; poruka "Poslano · Sto 7 · Tura 1" ili "Sačuvano · čeka slanje · Sto 7". Cijene uzima server u tom trenutku; promjena daje žutu karticu "Cijena promijenjena: Kafa 1,50 → 2,00 KM · Sto 7". Tura koja stigne nakon naplate stola otvori se kao "nije plaćeno" uz crvenu karticu "Tura 21:50 za Sto 5 stigla nakon naplate (Emir 22:00). Jesi li naplatio?" → **"Naplaćeno gotovina"** / **"Nije naplaćeno"**. Pogrešna tura se ispravlja stornom — nema drugog "poništi".

**Nargila.** Brend → arome ("Nema", "malo" ispod jedne kutije; do tri, "Mix 2/3") → Jači / Blaži → **"Dodaj nargilu · 15,00 KM"**. **Žar:** dugi pritisak na sto s nargilom → **"Žar"** se zaključi odmah kao stavka od 0 KM s 2 uglja (2 dodira); **"Nova lula"** se naplaćuje.

**Naplata.** **"Naplati 17,50"** → **"tačno · 20 · 50 · 100 · drugi iznos"**, **"Kartica"** samo s terminalom; kvačice za "svako svoje"; kusur krupno; gotovina tačno 3 dodira. Gost pobjegao: **"⋯ → Nije plaćeno"** → razlog; iznos ostaje na konobaru dok vlasnik ne odluči **"Otpis"** ili **"Naplatiti"**. Dvostruka naplata nije moguća.

**Storno.** Dugi pritisak → "Zaključene stavke se ne mijenjaju" → **"Zatraži storno"** → razlog (pogrešan unos · gost se predomislio · nije posluženo · reklamacija · ostalo). Do 5 minuta, nenaplaćeno, prolazi automatski; šanker odobrava do 15 minuta; inače "Storno čeka odobrenje — 5,00 KM ostaje u tvom pazaru dok se ne odobri". Uvijek piše "Vraća robu na stanje: da/ne" (prva tri razloga da, zadnja dva ne).

**Na račun kuće.** Piće za osoblje konobar odobrava sam sebi, do 3 KM i 2 po smjeni ("Osoblje: 1/2 (do 3 KM)"); gost vlasnika samo vlasnik; ostalo traži odobrenje. Gratis nikad ne vraća robu.

**Šta konobar ne može.** Ne unosi cijene, ne mijenja zaključeno, ne naplaćuje više nego što je ostalo, ne premješta sto dok nema mreže, ne odjavljuje se s neposlanim turama ("Imaš 2 neposlane narudžbe"), ne zaključuje ništa nakon predaje.

### Broj dodira

| Narudžba | Dodira |
|---|---|
| 2× kafa | 1 + 2 + 2 = **5** |
| Nargila (jedna aroma) + 2× Coca-Cola | 1 + 1 + 1 + 1 + 2 + 2 = **8** |
| Mix nargila (2 arome) + čaj s mlijekom (napomena) | 1 + 1 + 2 + 1 + 1 + 2 + 2 = **10** |
| Žar na postojeću nargilu | dugi pritisak + Žar = **2** |
| Naplata gotovinom tačno | Sto + Naplati + tačno = **3** (kartica: 4) |
| Šest gostiju plaća odvojeno | 2 + 6 × 3 ≈ **20**, bez računanja |
| Poruka u "Svi" | avatar + Razgovor (+ kanal) + polje + Pošalji = **4–5** + kucanje (nula u toku narudžbe) |
| Slika → pošalji | avatar + Razgovor (+ kanal) + Slikaj + okidač (+ potvrda slike u iPhoneovoj kameri) + Pošalji = **5–7** |
| Dodaj liniju u "Za naručiti" | dugi pritisak + "Dodaj u Za naručiti" = **2** |
| Završi smjenu | **1** s trake pri dnu (2 iz menija), pa isti koraci predaje — **0 dodatnih** |
| Preuzmi koleginu smjenu | avatar + Raspored + Preuzimam = **3** |
| Vlasnik: kopiraj i objavi sedmicu | **3**; ispravka ćelije = **2** |

### Rad bez mreže

Nacrti ostaju na telefonu; zaključene ture, naplate i storna čuvaju se i šalju čim se mreža vrati, ništa se ne upisuje dvaput, crvena oznaka nikad ne blokira rad. Telefon se javlja svakih 60 sekundi; prekid preko 10 minuta se zapisuje, sat telefona se uvijek ispravlja prema serveru, a kašnjenje preko 5 minuta se posebno navodi, neposlana tura starija od 5 minuta dobije traku. Poruke razgovora imaju odvojen red: zaglavljeno "nema leda" nikad ne zaustavlja predaju.

### "Završi smjenu" i šta se tada dešava

Kraj konobarove smjene je predaja gotovine — jedan put, jedan ekran, **"Završi smjenu"** (konobar *zaključi* turu, *završi* smjenu; šanker ili vlasnik *zatvara* smjenu lokala). Dugme je u meniju (2 dodira), a traka **"Završi smjenu · predaj gotovinu"** pojavi se sama kad konobar nema otvorenih stolova ni nacrta, sve je poslano, a do zatvaranja je manje od 2 sata ili je zadnja tura starija od 45 minuta (1 dodir); piše "Emir zatvara smjenu — predaj gotovinu" kad šanker krene zatvarati. Pravilo: "Predaješ gotovinu kad završiš, ne prije."

Koraci: riješeni stolovi i nacrti → slijepo **"Predajem gotovinu: ___ KM"** → PIN primaoca ili **"Predajem u kasu"** (koverta u sef, vlasnik prihvata ujutro) → otkrivanje: "Očekivano 412,50 · na čekanju: storno 5,00 (Sto 3), nije plaćeno 24,00 (Sto 9)" i ocjena "razlika −4,50 · u toleranciji (do 5,00)" ili "razlika −12,00 · označeno za razgovor" → **"Sažetak"** → **"Odjavi se"**. Blokirano s neposlanim turama ("Još 2 narudžbe čekaju slanje — uključi Wi-Fi ili mobilne podatke"), i na drugim konobarovim telefonima.

Aplikacija u tom trenutku sama sastavi sažetak — promet (612,50 KM), po kategorijama broj i iznos ("Nargila 34 · 507,00 · Kafa 52 · 78,00 · Sokovi 12 · 27,50"), storna, gratisi, stolovi, ture, gotovina, kartica, sati, predano, očekivano, ocjena — i upiše ga u Dnevnik kao "Završena smjena · Amar · 18:02–00:10 · promet 612,50 KM · …"; na Telegram ide posebna poruka samo ako je van tolerancije. Poslije predaje konobar ne može ništa zaključiti ni naplatiti — to je "zaključavanje" koje je Vedran tražio. Rana predaja nije alibi: ture s njegovog telefona pod imenom kolege se zapišu ("Nakon Amarove predaje: 3 ture na Amarovom telefonu pod Lejlom"), a s rasporedom i "Predao 22:00 · raspored do 01:00".

### Moja smjena

Tokom smjene samo brojevi: ture, stolovi, "Nargila 34 · Kafa 52", storna, gratis 1/2, sati; iznosi (promet, po kategorijama, gotovina, kartica, razlika naspram vlastitog prosjeka 30 dana, ocjena) tek nakon predaje — inače bi zbir odao pazar. Kategorija otvara **"Moje stavke"**, istu listu koju vidi vlasnik. Tu su zadnjih 30 smjena, **"Moji sati"**, **"Napomena"** na svaki red i **"Moji podaci"** sa spiskom vlastitih prijava (koji uređaj, kad). Kolegini iznosi nikad ne stižu na konobarov telefon.

### Raspored i zamjena

**"Raspored"**: **"Ova sedmica"** | **"Sljedeća"**, ponude i moji zahtjevi na vrhu (s **"Povuci"**); otvara se i bez mreže. Svoja smjena → **"Traži zamjenu"** → kolega ili otvoreno → *zamjena* / *bolest* → **"Pošalji"** (5–6 dodira); kolega **"Preuzimam"** (3) i svi vide novi raspored za 15 sekundi. Detalji u odjeljku 9.

### Razgovor sa slikama

**"Razgovor"**: **"Svi"** i **"Konobari"**; dugi pritisak → **"Odgovori · Dodaj u Za naručiti · Proslijedi u… · Prijavi vlasniku · Obriši"** (ili **"Ukloni sliku"**); na vrhu **"Učitaj starije"**, pri dnu **"Nova poruka ↓"** kad stigne nova; pri dnu polje, **"Slikaj"** (kamera direktno), **"Galerija"**, **"Pošalji"**. Slika se smanji na telefonu i pošalje čim ima veze (do 5 čeka; preko toga "Sačuvaj sliku u galeriju, pošalji kad bude veze"). Razgovor nikad ne prekida narudžbu: bez zvuka i prozora, samo broj na avataru; povratak vraća na sto i nacrt.

## 6. Kako radi vlasnik

Kontrolna ploča na telefonu i laptopu. Telefon: kartice **"Puls · Smjena · Roba · Više"**; pod "Više" su Meni i postavke, Izvoz, Dnevnik, Razgovor i Raspored, s crvenom tačkom i brojem stavki koje čekaju — vlasnik u 09:00 vidi da čekaju četiri zapisa i zamjena. Poslovni dan počinje u 06:00; smjena je jedinica odgovornosti; periodi **"Danas · Jučer · Ova sedmica · Prošla sedmica · Ovaj mjesec · Prilagođeno"**. Lokal "Vježba" služi za obuku (crvena traka VJEŽBA).

### Puls

Osvježava se svakih 15 sekundi ("Ažurirano 22:41"): Promet danas · Otvoreno · Gotovina očekivano · Storna / gratis · Ko radi ("predao 22:00 · još na rasporedu") · Neposlano ("nije se javio 25 min"); **"Zahtijeva pažnju"**; zadnjih 20 stavki (i provjera tajnog gosta u 10 minuta); stolovi po vremenu (ispod 1 h / 1–3 h / preko 3 h). Prazno: "Još nema narudžbi večeras — prvi sto se pojavi ovdje čim ga konobar zaključi."

### Pregled dana za 5 minuta

Stranica **"Smjena"**; ulaz je Telegram poruka ili oznaka Dnevnika. Zaglavlje: pazar, gotovina / kartica / gratis, razlike, manjak robe, grami i žar po luli, grami kafe po kafi. **"Zahtijeva pažnju"**: storna, gratisi i isplate na čekanju, nenaplaćeni i kasno stigli stolovi (**"Otpis"** / **"Naplatiti"**), popis van tolerancije ili bez svjedoka, smjene bez početnog popisa, otpis preko praga, odobrenja na tuđem telefonu, "storno pa naplata", telefoni bez veze, promijenjen polog, rano zatvaranje, predaje u kasu (**"Prihvati"**), nepopunjene zamjene, "planirano, nema smjene" / "radio bez rasporeda" — jedan dodir **"Odobri / Odbij / Bilješka / Razgovarano"**. Vlasnik unosi ukupno s terminala (razlika naspram naplata karticom traži bilješku) i **"Uzeo iz kase"**. Predaje pokazuju "u trenutku predaje −12,00 · sada −2,00". Traka po konobaru: promet, stolovi, čipovi kategorija, storna, gratis, otpis, ostalo, kartica %, sati, promet po satu, minute bez veze, čip tolerancije, napomena — svaki čip otvara stavke. Zatim odobravaoci, 10 najprodavanijih artikala, 5 najtraženijih aroma, popisi s **"Primijeni"**, "Nakon zatvaranja", "naspram istog dana, zadnje 4 sedmice", **"Pregledano"**.

### Dnevnik

**"Dnevnik"** (samo vlasnici): ko je šta uradio, po danu i smjeni. Kartica "Završena smjena": ime, vrijeme, promet, čipovi kategorija i živi čip "predao 598,00 · očekivano 602,50 · u toleranciji". Dodir na **"Nargila 34"** otvara te 34 lule: "21:47 · Sto 7 · Nargila jabuka + menta · 15,00 · naplaćeno" — vrijeme zaključenja, tura, sto, arome, cijena, status (naplaćeno, nije plaćeno, storno, storno na čekanju, gratis, otvoreno); kasne ture nose "kasno" i "stiglo 22:03" ako su stigle više od 2 minute nakon zaključenja. Isto za svaku kategoriju, storna, gratise i nenaplaćeno; zbir u podnožju jednak zaglavlju. Zahtjev i odluka su jedna kartica ("✔ Riješio Haris · 09:41"). **"Važno / Sve"**, **"Osoba · Vrsta · Period"**, oznaka "Dnevnik (4)". Više u odjeljku 9.

### Roba

**"Stanje šanka"** (paketi + komadi; ok / nisko / u minusu / bez cijene), **"Prijem robe"**, **"Popisi"**, **"Otpis"** po osobi, liste **"U minusu"**, **"Bez normativa"**, **"Bez cijene"**, **"Kasno sinhronizovano"**, kretanja po artiklu, kartice **"Nargila"** i **"Kategorije"**.

**Prijem svaki dan.** **"Novi prijem"** (i prečica na Pulsu): dobavljač zadnji, datum današnji. **"Sa slike"**: vlasnik slika otpremnicu, aplikacija je pročita — prepoznato zeleno, nesigurno žuto s pročitanim tekstom, nepoznato traži **"Poveži"** (pamti se), **"Novi artikal"** ili **"Preskoči"**. Ništa se ne knjiži dok vlasnik ne pogleda svaku liniju i ne dodirne **"Proknjiži"**; **"Ručno"** je isti obrazac; jedna do tri minute; ispravka samo korekcijom; slika ostaje kao dokaz. Nepoznata linija je **"Nepoznata stavka"** dok se ne poveže; prijem s datumom prije zadnjeg popisa označen je **"Već prebrojano"** i ne ulazi dvaput u teoretsko. **"Prijemi"**: mjesec po kategoriji, filter "Ručno uneseno".

**Popis** je slijep: teoretsko se vidi nakon **"Predaj"**, sljedeći čuvar potvrđuje **"Potvrđujem stanje"**, stanje se mijenja tek na vlasnikovo **"Primijeni"**. Detalji, **"Nargila"** i **"Kategorije"** u odjeljku 8.

### Meni i postavke

Proizvodi s cijenom koja važi odmah ("mijenjaj cijene prije otvaranja smjene"), **"Omiljeno"** (do 12), piće osoblja, normativi, grami nargile s **"Izmjereno"**; arome; kategorije s brzim napomenama; stolovi i zone; osoblje; uređaji (kod, opoziv, zadnje javljanje, sat); postavke s pragovima; **"Šabloni smjena"**; **"Početno stanje"** (jednom, s cijenom po artiklu); **"Pravila"** s verzijama i potvrdama; ishodi razgovora.

### Raspored

Telefon: kartice dana s **"+"** za osobu (2 dodira); laptop: mreža šabloni × dani; **"Kopiraj prošlu sedmicu"** + **"Objavi raspored"** = 3 dodira, četiri ispravke još 8–12; kartice **"Zamjene"** i **"Sati"** (faza 3b). Detalji u odjeljku 9.

### Razgovor

Vlasnik vidi **"Svi"** i **"Admini"**; laptop u dvije kolone (faza 3b). U "Svi" može slikati kamerom, ali nema **"Galerija"** — u galeriji su snimci ekrana kontrolne ploče. **"Naručeno ✓"** na traci "Za naručiti"; briše bilo šta u "Svi" i "Admini", **"Utišaj"**, **"Obriši sve od … u zadnjih 30 min"**, **"Proslijedi u Admini"**.

### Izvoz

Datoteke za Excel s ispravnim č/ć/š: smjene, dnevni pazar ("interni izvještaj — nije fiskalni"), stavke (inicijali, prekidač "puna imena"), popisi, prijemi, nargila, kategorije, sati.

### Obavijesti na Telegram

Svaki vlasnik poveže Telegram kodom iz postavki; kad jedan riješi stvar, kod drugih je riješena. Telegram je podskup Dnevnika. Stiže: smjena zatvorena (uvijek — promet, gotovina, kartica, gratis, storna, razlika, manjak robe, popis, top aroma, zadnja narudžba, linija po konobaru "Amar 612,50 · predao 598,00 · u toleranciji"); predaja van tolerancije (odmah, riječ i predani iznos, nikad razlika); smjena otvorena ili prisilno zatvorena; storno nakon naplate ili na tuđem telefonu; gratis preko 20 KM; šanker preko limita; popis s manjkom preko 10 KM; isplata preko 50 KM; zaključan PIN; greška u sažetku; bolovanje; smjena nije zatvorena sat prije kraja dana; nepopunjena zamjena manje od 24 h i 4 h prije smjene; sažetak "Admini" (do 4 dnevno, razmak 30 minuta); server ne radi. Tišina 03:00–10:00 osim zatvorene smjene, predaje van tolerancije i pada servera; do 6 poruka na sat; **"Tiho do sutra"**. "Konobari" se nikad ne prenosi.

## 7. Novac i poštenje

Svaka marka i gram ulaze jednom, na izvoru; svaki broj je izveden; označavaju se obrasci kroz smjene, nikad jedan čin; osoba prva vidi svoj broj; pragovi su u odjeljku **"Pravila"**.

### Slijepa predaja gotovine

Svaki konobar drži svoju gotovinu i na početku dobija kusur iz kase ("polog konobaru"); na kraju upiše koliko ima prije nego što vidi koliko treba. Očekivano po konobaru = polog + naplate gotovinom + nenaplaćeni stolovi koje je označio + storna koja čekaju na njegovim stavkama − storna odobrena poslije predaje; očekivano u kasi = početni polog + polozi u kasu − odobrene isplate − polozi konobarima − povrati gostima; ukupno je zbir — jedna formula za sve ekrane. **Na čekanju ne smanjuje očekivano:** storno koje čeka ostaje u pazaru tražioca, nenaplaćen sto u pazaru onoga ko ga je označio, gratis ili isplata na čekanju ne mijenjaju ništa. To ukida interes za storno nakon naplate i za "dobavljač leda 60 KM".

### Očekivano naspram predanog

Razlika se nigdje ne upisuje kao trajni broj — ni u naslov, ni u Telegram — nego se računa iznova i pomjera sa svakom odlukom ("nakon predaje: storno odobren −3,00"). Tolerancija je 5 KM ili 1 % prometa, koje god je veće: "u toleranciji" ili "označeno za razgovor"; žuto samo izvan tolerancije, crveno nakon tri označene smjene u 30 dana; višak koji objašnjava kasniji storno ili tura nakon zatvaranja navodi se kao objašnjen. Zatvaranje smjene lokala: blokirano dok postoji otvoren sto ili nacrt; završni popis; prebrojana kasa i koverte — razlika preko 5 KM ili 1 % traži bilješku; PIN. Zatvaranje više od 60 minuta prije kraja (03:00) navodi se kao rano. Zaboravljena smjena: Telegram sat prije kraja dana, prisilno zatvaranje s bilješkom, **"Naknadna predaja"** za one koji nisu predali. Sljedeći početni polog je ono što je ostalo u kasi umanjeno za ono što je vlasnik uzeo.

### Storno i gratis pravila

- Sam sebi: svoja nenaplaćena stavka do 5 minuta; sve drugo na odobrenje. Šanker: šestocifreni PIN, stavke mlađe od 15 minuta; starije vlasnik.
- Vlasnik odlučuje samo sa svog uređaja i nikad ne kuca PIN na tuđem telefonu — otkucan PIN se uhvati jednom. Šankerova odluka na tuđem telefonu se označi. Niko ne odobrava sam sebi, osim vlasnika ("Odobrio sam sebi").
- Storno nakon naplate uvijek ide na Telegram; roba se vraća samo kod razloga koji to dozvoljava; gratis nikad.
- Gost bez plaćanja nije storno nego **"Nije plaćeno"**: iznos ostaje na konobaru do **"Otpis"** ili **"Naplatiti"**.
- Piće za osoblje 2 po smjeni do 3 KM; gost vlasnika samo vlasnik; popusta nema.
- Otpis preko 10 KM, ukupno preko 20 KM u smjeni ili artikal s liste popisa traži PIN odobravaoca; isplata preko 50 KM traži vlasnika odmah.

### Pragovi i "označeno za razgovor"

Aplikacija ovo ne sprečava nego pokazuje — prvo samoj osobi:

| Mjera | Šta se gleda | Prag → "označeno za razgovor" |
|---|---|---|
| Storno % | odobrena storna naspram vlastitog prometa (pogrešan unos do 60 s se ne računa) | preko 3 % ili više od 3 vlastita storna u smjeni |
| Storno pa naplata | isti sto u 5 minuta | svaki slučaj naveden; po konobaru na 30 dana |
| Odobrenja | po odobravaocu i po paru odobravalac–tražilac | više od 3 istom tražiocu u smjeni; šanker preko 30 KM storna u smjeni |
| Na račun kuće % | gratis naspram prometa (bez gosta vlasnika) | preko 2 %; pojedinačno preko 20 KM ili preko 50 KM u smjeni |
| Razlika pazara | predano − očekivano (živo) | preko 5 KM ili 1 %; crveno nakon 3 označene smjene u 30 dana |
| Kartica % | vlastite naplate karticom naspram prometa | preko dvostrukog vlastitog medijana (srednje vrijednosti) za 30 dana (nakon 10 smjena) |
| Otpis | vlastiti otpis po smjeni | preko 10 KM ili više od 3; isti artikal u 3 smjene u 7 dana |
| Ostalo | stavke slobodnog teksta | više od 3 ili preko 20 KM; **"Napravi proizvod"** jednim dodirom |
| Manjak robe | završni popis po čuvaru (smjene s početnim i završnim popisom) i po artiklu na 30 dana | u smjeni preko 10 KM |
| Grami i žar po luli | duhan ÷ lule, ugalj ÷ lule | van izmjerenog ± 15 %; preko 5 uglja po luli |
| Grami kafe po kafi | kafa ÷ prodane kafe (vaganjem) | van normativa ± 15 % |
| Prihod po satu | po konobaru, samo vlasnik, preko dužeg od odrađenog i planiranog | ispod 0,6 vlastitog medijana i medijana lokala za isti dan u sedmici, nakon 10 smjena |
| Bez mreže | prekidi preko 10 minuta; predaje s mrtvim telefonom | minute na 30 dana objavljene; 2 predaje "izgubljen telefon" u 30 dana navedene |
| Raspored naspram rada | kašnjenje, rani odlazak, planiran a nije radio, radio bez rasporeda | navedeno, nikad označeno; "prva tura nije dolazak" |
| Sumnjivo savršeno | razlika tačno 0 na 5 uzastopnih popisa istog brojača | vlasnikov nasumični popis (faza 5) |
| Identitet | isti korisnik na dva telefona u 5 minuta; novi uređaj usred smjene; posuđene sesije; novi korisnik prijavljen na vlasnikovom uređaju | navedeno |

### Šta osoblje vidi o sebi

**"Pravila"** se objavljuju prije prve smjene, svaka promjena je zapis i obavijest u "Svi", svako je potvrđuje ("Pročitao sam Pravila v3"). Riječ je "odstupanje"; konobar na svaki svoj red stavlja **"Napomena"**; lični prosjeci tek nakon 10 smjena; nema rang-liste; kolegin novac se ne vidi nigdje. Svaka oznaka dobije ishod (**"Razgovarano · OK / opomena / greška aplikacije"**); OK ispada iz "3 u 30". Osoblje ima **"Moji sati"**, **"Raspored"**, **"Moji podaci"** (izvoz vlastitih podataka, spisak vlastitih prijava — koji uređaj, kad) i odjeljak **"Šta aplikacija bilježi"**: polja, ko šta vidi, nema lokacije ni kontakata, kamera samo na "Slikaj", čuvanje (24 mjeseca uređaji, 12 mjeseci tekst, 90 dana slike), Telegram izvodi, bolovanja vidljiva vlasniku, brojanje nepročitanih koje niko ne vidi, vlasnikov uvid u svaku stavku. Zajednički bonus (razlika gotovine unutar ±0,5 %, manjak unutar 2 % vrijednosti) najavljuje se u Pravilima i razmatra nakon dva mjeseca pouzdanih popisa.

### Šta aplikacija ne može uhvatiti

Ostaje na vlasniku, kroz "Pravila": neuneseno piće (vaganje kafe, duhana i šećera; "Šank pravi samo ono što je zaključeno"; mjesečni tajni gost na Pulsu u 10 minuta; po želji "ako vam konobar ne pokaže narudžbu na telefonu, piće je besplatno" — odluka 3); "šanker sipa, konobar ne uzima flaše sa police"; **"Pokaži narudžbu"** protiv zakidanja gostiju; mjerni čepovi; vlasnikova inventura i nasumični popisi 5 artikala (sedmično žestoka pića u pilotu); vlasnik prima robu; dijeljeni PIN ("obojica odgovaraju"); telefon koji "izgubi" ture dvaput ide na zajednički uređaj; "narudžbe se zaključuju, ne pišu u Razgovor"; dogovor cijelog osoblja (prihod po satu naspram gostiju).

## 8. Roba i stanje šanka

### Normativi

Proizvod je ono što konobar dodirne, artikal ono što stoji na polici, normativ ih spaja; za većinu menija je jedan na jedan. Normativi: espresso (7 g kafe + 5 g šećera), gin tonik (30 ml gina + 1 tonik), nargila (grami duhana, uglja podrazumijevano 3). Grami se mjere: vlasnik izvaga 10 lula po proizvodu, prosjek je norma s pojasom ± 15 %. "Dodatni žar" je 0 KM i 2 uglja. Bez normativa → **"Bez normativa"**. Pakovanje pretvara (gajba 24, duhan 250 g, ugalj 64 ili 72 — vlasnik potvrđuje). Svaki artikal na početku dobija nabavnu cijenu, pa je manjak u KM stvaran od prvog dana; bez cijene → **"Bez cijene"**. Prijemi ažuriraju prosječnu cijenu.

### Kretanje robe

Jedina istina je evidencija kretanja robe (početno, prijem, prodaja u trenutku zaključenja, storno, otpis, korekcije); stanje je zbir. Prodaja se nikad ne blokira — roba može u minus (**"U minusu"**: "zadnji prijem prije 9 dana"). Tura koja stigne poslije potvrđenog popisa ne oduzima robu dvaput; navodi se pod **"Kasno sinhronizovano"** ("objašnjava manjak 1 kom · 1,80 KM").

### Brzi popis vaganjem

Dvadesetak artikala: žestoka pića po flaši, pivo, najprodavaniji sokovi, energetska pića, cigarete, otvoren duhan (vaga), ugalj, kafa (vaga), šećer (vaga). Na početku i kraju svake smjene, ista lista, da smjena bude omeđena popisom na početku i kraju i manjak pripadne jednom čuvaru; bez početnog popisa zatvaranje ide samo vlasnikovim izuzetkom, manjak se navodi "bez početnog popisa" i ne ulazi u čuvarov zbir. Vaga (oko 30 KM) obavezna prije pilota. Jedan ekran, veliki broj, grami s odbijenom tarom, teoretsko skriveno do predaje; blokiran dok neki telefon ima neposlane ture; van tolerancije traži bilješku. Tolerancije: zatvorene flaše 0, otvorena žestoka 30 ml, duhan 5 g, kafa 20 g, ugalj 2 komada. Ispod 5 minuta. Manjak po čuvaru (30 dana) i po artiklu (30 dana — flaša sedmično je nevidljiva u smjeni, očigledna u mjesecu).

### Mjesečna inventura

Isti ekran bez filtera, sva roba, vlasnik jednom mjesečno; "četvrt kutije" samo ovdje. Manjak u KM = razlika × nabavna cijena. Trošak robe iz prodaja; "stvarni trošak" dodaje otpis, korekcije i kasno sinhronizovano — razlika je broj curenja. Marža po proizvodu na meniju; pregledi marže i liste za naručivanje su faza 5.

### Formula za nargilu

Duhan je artikal po aromi u gramima (pakovanja 50 / 200 / 250 / 1000 g, otvorena se važu). Norma 20 g po luli, 1 kg = 50 lula; miješana lula dijeli normu (2 arome = 10 g + 10 g). Izvještaj **"Nargila"** (**"Ovaj mjesec · Prošli mjesec · Prilagođeno"**) po aromi i ukupno: početno (završna vaga prethodnog perioda), primljeno (svi prijemi), završno (zadnji potvrđeni popis), potrošeno = početno + primljeno − završno, očekivano lula = potrošeno ÷ 20, prodano lula (miješana je jedna, žar nije lula), razlika = **"lule bez narudžbe"**, i u KM. Vlasnikov primjer je test: primljeno 15 kg, ostalo 4 kg → 11 kg → 550 lula; zaključeno 500 → 50 lula bez narudžbe (≈ 750,00 KM po 15 KM), a 4 kg je početno sljedećeg mjeseca. Izmjereni grami pokreću pojas ± 15 % po smjeni; mjesečni izvještaj koristi normu 20 g i pokazuje "po normi 20 g" i "po izmjerenom" kad se razlikuju. Ugalj isto, u komadima.

### Kategorije i marža

Jedna lista kategorija za proizvode i robu (privremeno Kafa · Bezalkoholna pića · Energetska · Nargila · Hrana · Potrošni). Izvještaj **"Kategorije"** po kategoriji: **Nabavka** = prijemi (plus korekcije, minus povrati); **Prodaja** = zaključeno minus storna (ista podjela kao u sažecima smjena); **Utrošak** = nabavna vrijednost prodanog; **Bruto marža** = Prodaja − Utrošak i u postotku; **Otpis / manjak**; **Prodaja − Nabavka**, gotovinski pogled koji je vlasnik tražio, s napomenom da zalihe (kupiš 15 kg, prodaš 11) tu kolonu ljuljaju — marža je pošten broj, gotovinski pogled iskren, oba se prikazuju. Ugalj i duhan u Nargilu; šećer, čaše, salvete u Potrošni ili Kafu po vlasnikovoj odluci; bez kategorije → **"Bez kategorije"**.

## 9. Ekipa: Razgovor, Dnevnik, Raspored

### Razgovor

Tri stalna kanala: **"Svi"**, **"Konobari"**, **"Admini"**; ko šta vidi odlučuje uloga (odjeljak 4) i to provjerava server pri svakom čitanju, pisanju, citiranju i otvaranju slike. Članstvo je vidljivo ("Članovi 5 · Amar, Lejla, Dino, Emir (šanker), Haris"), a "Konobari" dobije liniju za svaku promjenu ljudi ("Lejla dodana (konobar) · Haris", "PIN za Amara resetovan", "Amar deaktiviran") da svi znaju ko se sad može prijaviti kao ko. Pravilo: "Vlasnik ne pravi naloge koje sam koristi."

**Napomena o iskrenosti**, doslovno u Pravilima: "Vlasnik u aplikaciji ne vidi kanal *Konobari* i ne može ga otvoriti. Poruke su ipak zapisane u bazi na serveru, kao i sve ostalo; bazu mogu otvoriti vlasnik i Vedran. Kanal nije tajan — samo nije na vlasnikovom ekranu. Ne pišite ništa što ne biste rekli naglas. Poruke se brišu nakon 12 mjeseci, slike nakon 90 dana; kopije u sigurnosnim kopijama žive još do 60 dana. Obrisana slika nestaje sa servera odmah, sa telefona do sat vremena kasnije; original ostaje u galeriji onome ko ju je slikao. Ko je šta pročitao aplikacija pamti samo da bi brojala nepročitane poruke — niko to ne vidi na ekranu." Vlasnikovo obećanje da neće otvarati bazu je pravilo, ne kod (odluka 20).

**Novac ne ulazi u "Svi" ni u "Konobari".** Aplikacija tamo nikad ne piše iznose. Ako čovjek napiše nešto što liči na iznos ("12,50 KM", "očekivano", "manjak", "razlika", "predao"), polje pita "Iznosi kolega ne idu u Svi — pošalji u Admini?" s **"Ipak pošalji"**, koje se tiho zabilježi. Pravilo: "Ničiji pazar, manjak ili razlika ne ide u "Svi" ni u "Konobari" — ni kao slika."

**Poruke i slike.** Tekst do 2000 znakova, jedna slika po poruci, bez ispravljanja. Slike se smanjuju na telefonu (1280 px za razgovor, 1600 px za otpremnice) i gube podatke o lokaciji; server prima samo JPEG do 1,5 MB (otpremnice 2,5 MB), najviše 25 slika i 30 MB po osobi dnevno ("Dnevni limit slika — sutra opet"), 200 MB mjesečno za lokal. Sliku otvara samo ko smije vidjeti poruku; slika bez poruke briše se nakon 60 minuta; slike razgovora žive 90 dana ("Slika istekla") samo na serveru (najviše 90 dana × 200 MB ≈ 600 MB), otpremnice se čuvaju s bazom. Isto osvježavanje svakih 15 sekundi nosi i razgovor; broj nepročitanih broji samo poruke ljudi; nema "vidjeli" — to bi vlasniku dalo dnevnik ko je šta pročitao; zvuk isključen.

**Moderacija.** Svoj tekst autor može obrisati u roku od 15 minuta. Vlasnik briše bilo šta u "Svi" i "Admini" ("Obrisao vlasnik · 22:41"), **"Utišaj"** ("Vlasnik te utišao do 10:00"), **"Obriši sve od Amara u zadnjih 30 min"**. U "Konobari" tekst briše samo autor, ali **sliku ukloni bilo koji član bilo kad** — slika gosta ne smije stajati 90 dana gdje vlasnik ne može doći. **"Prijavi vlasniku"** (prosljeđivanje u "Admini") je jedini put osoblje → Admini, da konobar prijavi curenje ili zlostavljanje bez vlasnikove saradnje; **"Proslijedi u Svi"** prosljeđuje poruku iz "Konobari" u "Svi"; brisanje originala ne briše kopiju. Pravilo: "Šta napišeš u Konobarima kolega može proslijediti. Sliku u Konobarima može ukloniti svako; tekst samo autor. Slike samo šanka, robe i prostora — gosti nikad."

**"Za naručiti".** Prikačena poruka "Za naručiti" (do 500 znakova) u "Svi": traka → tekst → **"Sačuvaj"**, ili dugi pritisak na poruku → **"Dodaj u Za naručiti"** (prva linija do 80 znakova, 2 dodira). Svaka promjena ostavlja liniju "Amar je izmijenio Za naručiti: led, limun, Coca-Cola 2 gajbe"; vlasnik dodirne **"Naručeno ✓"**. Sistemske linije su siv tekst i najviše jedno dugme-veza ("Raspored →").

### Dnevnik

Jedan zapis "ko je šta uradio", nastao spajanjem stare "Aktivnosti" i zapisa radnji; upisuje se u trenutku radnje, ne mijenja se, čita ga samo ova stranica i Telegram. Ture i naplate nisu zapisi; sve o čemu bi admin pitao "ko je ovo uradio?" jeste:

- **Smjene i predaje:** "Smjena otvorena · Amar · 18:03 · automatski (prva tura)"; "Smjena zatvorena · Emir · 00:42 · pazar 1.812,50 KM · gotovina 1.612,50 · kartica 200,00 · razlika −4,00 · manjak robe 6,20 KM · popis predan · 3 van tolerancije · zadnja narudžba 00:10"; "Završena smjena · Amar · 18:02–00:10 · promet 612,50 KM · Nargila 34 · 507,00 · Kafa 52 · 78,00 · Sokovi 12 · 27,50 · storno 1 · 3,00 · gratis 2 · 6,00 · predao 598,00"; prisilno zatvorena, pregledana, predaja prihvaćena, naknadna, nakon predaje (storno odobren −3,00 / 2 ture kasnije), predaja prije kraja rasporeda, izuzetak vlasnika, promjena pologa.
- **Novac, roba, meni:** storno i gratis traženi i odlučeni (ko, sto, iznos, razlog, "na Amarovom telefonu"), nije plaćeno, isplate, uzeto iz kase, polozi, ishod razgovora; prijem proknjižen, popis predan / potvrđen, otpis, korekcija; cijena ("Kafa 1,50 → 2,00 KM"), proizvod, postavke, pravila.
- **Ljudi, raspored, razgovor, sistem:** konobar dodan / PIN / deaktiviran, uređaj, PIN zaključan, telefon bez veze, sat kasni; raspored objavljen i promijenjen, nije došao, bolovanje, zamjene, šablon; slika uklonjena, upozorenje o iznosima, utišan; noćna provjera sažetaka ("promet 1.812,50 ≠ 1.810,50") — greška aplikacije, ne lokala.

"Tihi" zapisi (zahtjevi, polozi, potvrde pravila, promjene rasporeda, sitni otpis) skriveni su pod **"Važno"**; zahtjev i odluka su jedna kartica, pa petak ima 25–35 kartica, ne 80. Filteri **"Osoba"** (za "ko je ovo uradio?", ne za nečiju vremensku liniju), **"Vrsta"** (Smjene · Novac · Roba · Meni i cijene · Ljudi i uređaji · Raspored · Razgovor · Sistem), **"Period"**; nove kartice stižu iza "3 nove"; laptop ima tabelu Vrijeme · Ko · Šta · Objekat. Vremena stavki su vrijeme zaključenja na telefonu, ispravljeno za kašnjenje sata.

### Raspored

**Model.** Šablon je imenovani raspon: **"Dnevna"** 08–16 i **"Večernja"** 16–01; još jedan ("Vikend večernja" 18–03) je jedan unos. Sedmica je **"Nacrt"** do **"Objavi raspored"**, poslije svaka izmjena važi odmah. Vrijeme se kopira iz šablona pri dodjeli; svaka izmjena ostavlja zapis s prije/poslije; zamjena ne prepisuje ime (davalac "zamijenjen", primalac novi red); uklanjanje nakon objave je status s bilješkom. Planirani sati su nominalni, odrađeni od prve radnje do odjave.

**Vlasnik pravi sedmicu.** **"Kopiraj prošlu sedmicu"** (redovni ljudi, ne jednokratne zamjene) → ćelija → osoba (2 dodira); druga smjena istog dana pita jednom **"Dupla smjena — svejedno dodaj"** (3), preklapanje nije moguće; **"Ukloni"** (2). **"Objavi raspored"** → "Raspored za 14.09.–20.09. je objavljen — Raspored →" u "Svi"; poslije objave najviše jedna linija po vlasniku dnevno ("Haris mijenja raspored 14.–20.09. — Raspored →"), bez razloga i bilješke.

**Zamjene.** Osoblje vidi samo objavljene sedmice i o kolegama samo ko kad radi; bolovanje i izostanak su prazno mjesto ("Bolovanje vidi samo vlasnik."). Zahtjev ide kao linija u "Konobari" ("Amar traži zamjenu · pet 18.09. Večernja 16–01 — Raspored →"); **"Preuzimam"** daje liniju u "Svi" "Zamjena · pet 18.09. Večernja — Dino umjesto Amara". Razlog "bolest" odmah označi red kao bolovanje — jedini put kojim konobar sam unosi bolovanje u raspored (vlasnik ga može upisati i ručno) — i šalje vlasniku Telegram; linija u "Svi" je ista kao za svaku zamjenu. Vlasnik ne potvrđuje zamjene; može promijeniti ćeliju — to je veto. Nepopunjen zahtjev ide u "Zahtijeva pažnju" i na Telegram manje od 24 h i 4 h prije smjene; vlasnik **"Dodijeli"** (3 dodira; do 7 dana nakon datuma kao "dodijeljeno naknadno") ili **"Odbij"**. Prošla smjena se ne preuzima; isti dan da. Do faze 3b Pravila kažu: "Zamjenu dogovori u Konobarima — vlasnik je upiše u raspored; bolestan? Javi vlasniku."

**Izostanak i prošli datumi.** Vlasnik označi **"Nije došao"** ili poništi; na prošlim datumima moguće je samo planirano ↔ nije došao i planirano → bolovanje, nikad ukloniti — niko ne može naknadno skloniti osobu s noći kad je nestala roba. Osoblje samo ne mijenja status; ništa se ne označava automatski; deaktivacija pretvara buduće smjene u "uklonjen". Nema minimuma ljudi, pravila o odmoru ni praznika.

**Planirano naspram odrađenog** (faza 3b). **"Sati"** po mjesecu spaja raspored sa stvarnim smjenama: planirani i odrađeni sati, kašnjenje veće od 30 minuta tolerancije, rani odlazak, "planirano, nema smjene" i "Radio bez rasporeda: Dino · pet 18.09. · prva tura 16:12" — osoba koja *jeste* bila tu, a nije na planu. Prva tura nije dolazak: "prva tura 16:40 (+40 min)" je materijal za razgovor, nikad oznaka. Po osobi po mjesecu: planirane smjene i sati (osnova za plaću — većina lokala plaća dnevnicu, odluka 22), odrađeni sati, bolovanja, izostanci, zamjene; izvoz "sati"; konobar vidi samo svoje u **"Moji sati"**. Noćna provjera dodaje "Planirano, nema smjene" i "Radio bez rasporeda" u "Zahtijeva pažnju".

## 10. Tehnika ukratko

Aplikacija je web-stranica koja se na telefon instalira kao aplikacija (Nuxt), radi na jednom malom iznajmljenom serveru i sve pamti u jednoj datoteci baze (SQLite) koja se svakog sata kopira, a dnevno i van servera. Nema skupih servisa; upozorenja idu na Telegram. Sama baza čuva pravilo da se zaključeno ne mijenja.

| Šta | Gdje | Mjesečno |
|---|---|---|
| Server (jedan proces, jedna datoteka) | iznajmljeni VPS, Ubuntu | oko 5 EUR |
| Vanjske kopije (baza + slike otpremnica) | Cloudflare R2 | besplatno do 10 GB |
| Čitanje otpremnica sa slike | Anthropic (Claude) | oko 0,03 USD po slici, ispod 1 USD |
| Upozorenja | Telegram bot | besplatno |
| Nadzor rada servera | UptimeRobot, healthchecks.io | besplatno |
| Domena i HTTPS | vlasnik ili Vedran (odluka 11) | nekoliko KM |
| Kuhinjska vaga | lokal | oko 30 KM jednom |

**Rad bez mreže.** Nacrti ostaju na telefonu; zaključene ture, naplate i storna telefon čuva i šalje čim se mreža vrati; server sve prima tačno jednom. Ako aplikacija ne radi, vrijedi papirni blok, sutradan se unese kao "naknadno".

**Sigurnosne kopije.** Svakog sata od 12:00 do 04:00 (čuva se 48) i dnevno u 05:00 (čuva se 60), dnevno na R2. Kopija nije gotova dok povrat nije isproban — mjesečna vježba se datira. U 05:30 aplikacija iznova preračuna zatvorene smjene i poredi sa sažecima; odstupanje je greška aplikacije i ide na Telegram. Slike razgovora ostaju samo na serveru.

**Ko drži ključeve.** Domena i server na vlasnikovo ime s Vedranom kao adminom, ili pisana bilješka da su baza i kopije vlasnikove; druga osoba drži pristup u zajedničkom trezoru lozinki. Vlasnik dobija stranicu na bosanskom: "aplikacija ne radi" → papirni blok; kako pokrenuti server; kako skinuti sinoćnu kopiju; koga zvati. Tajni ključevi žive samo na serveru.

## 11. Plan izgradnje

Sati su procjena za Vedrana koji planira s AI modelima i testira na pravim telefonima; oko 30 % svake faze su testovi. Svaka od faza 1–3 upotrebljiva je sama za sebe. Pilot počinje kad je faza 2 gotova. Dijelovi ekipe koje pilot treba prve noći (Dnevnik sa sažetkom, Razgovor s tekstom i "Za naručiti", Raspored s objavom) su u fazi 2 — navike se stvaraju u prvim sedmicama; ostalo (slike, prosljeđivanje, filteri, zamjene i Sati) je faza 3b tokom pilota.

| Faza | Šta | Sati | Gotovo kada |
|---|---|---|---|
| 0 — Temelji | baza s pravilima nepromjenjivosti, prijava, uređaji i PIN-ovi, osnovni računi, server, kopije, nadzor, uputstvo, zabrana engleskog | 22–32 | Testovi dokazuju da se zaključeno ne mijenja, da tura ulazi cijela ili nikako, da ponovljeno slanje daje jedan zapis i da 125050 feninga ispisuje 1.250,50 KM; sinoćna kopija se vrati na laptop. |
| 1 — Konobar naručuje | prijava, stolovi, dodaj, nargila, zaključi, naplata; rad bez veze; auto-otvaranje smjene; instalacija; ime i domena odlučeni prije | 50–70 | Dodiri se drže na srednjem Androidu i bez Wi-Fi-ja sve stigne tačno jednom; dva konobara odrade petak u "Vježbi" uz papir bez propusta i jedan kaže da je brže od bloka; nijedna engleska riječ na konobarovom ekranu. |
| 2 — Smjene, gotovina, pravila, Puls, Dnevnik, Razgovor, Raspored | puna smjena (polog, obavezan početni popis, storno, gratis, brzi popis vaganjem, predaja, isplate, prisilno zatvaranje), "Završi smjenu" sa sažetkom, Moja smjena, Pravila, Puls i Smjena, više vlasnika s Telegramom; **Dnevnik** (19–24 h), **Razgovor** s tekstom (10–13 h), **Raspored** osnovni (8–10 h) | 80–106 | Simulirana noć (3 konobara, 40 tura, 3 storna, 2 gratisa, 1 nenaplaćen) daje očekivanu gotovinu do feninga, a prava smjena se zatvori u aplikaciji s porukom o pazaru u minuti. **Vlasnik dodirne "Nargila 34" i 34 lule imaju vremena koja se slažu sa stolom, a Amar vidi istu listu**; "nema leda" bez Wi-Fi-ja stigne jednom i ne blokira predaju; sedmica objavljena u 3 dodira; nijedna engleska riječ na vlasnikovom ni na konobarovom ekranu. |
| 3 — Istina o robi | stranice Roba, prijemi, otpis, inventura, kasno sinhronizovano, potrošnja po smjeni, normativi s vaganjem, Priprema, Izvoz, **Prijem sa slike**, **Nargila** i **Kategorije** | 57–77 | Stanje se slaže s formulom i za miješanu nargilu (10 g + 10 g + 3 kom), "2 gajbe + 7" pokaže 55, slika otpremnice s 8 stavki da najmanje 6 prepoznatih i ništa bez "Proknjiži". Nargila reproducira 15 kg / 4 kg → 550 lula; Kategorije se slažu sa smjenama i prijemima do feninga. |
| 3b — Ekipa (tokom pilota) | **slike i kamera** (10–13 h, 2–3 na iPhoneu), ostatak Razgovora (3–4 h), ostatak Dnevnika (7–8 h), **Zamjene i Sati** (9–13 h) | 29–38 | Slika s iPhonea bez Wi-Fi-ja stigne jednom u najviše 7 dodira, 26. slika u danu se odbija, slika od 91 dana nestane a otpremnica od 400 dana ostane. Zamjena promijeni mrežu za 15 sekundi, bolovanje stigne vlasniku s razlogom a u razgovor bez njega, Sati pokažu kašnjenje i "radio bez rasporeda" bez lažne oznake. |
| 4 — Pilot | dvije sedmice papirne osnove; veče postavljanja iz šablona lounge lokala (oko 10 kategorija, oko 70 proizvoda, arome, ugalj, lista popisa, stolovi, tri kanala, dva šablona smjena), **"Početno stanje"** s cijenom po artiklu i vaganje 10 lula po proizvodu; sedmica s blokom paralelno; dnevni pregled od 5 minuta; Viber se gasi ili ostaje poslije 2. sedmice (odluka 24) | ~15 | Sedam uzastopnih zatvorenih smjena s predajama i popisima, svaka pregledana, papirni pazar objašnjen; dvije sedmice bez izgubljenih tura; vlasnik sam vrati kopiju; odluka o nastavku nakon 4 sedmice. |

**Mjerila pilota:** srednja razlika gotovine do 5 KM i najviše 1 označena predaja po konobaru sedmično; manjak brzih artikala do 2 % vrijednosti sedmično; grami po luli u pojasu u 80 % smjena; 90 % kupovina tajnog gosta nađeno na Pulsu u 10 minuta; od dodira do zaključenja do 25 sekundi; pregled do 5 minuta u 6 od 7 dana; svaka predaja kroz "Završi smjenu" (nula naknadnih u 3. sedmici); anonimna anketa od 3 pitanja u 2. i 6. sedmici ("brže od bloka?", "fer?", "šta smeta?").

**Ukupno:** 240–325 sati do kraja faze 3b, 16–22 sedmice po 15 sati; pilot nakon faze 2, na 150–210 sati (10–14 sedmica).

**Faza 5**, po prioritetu: osvježavanje bez čekanja; **"Historija"**; **"Osoblje"** s odstupanjima; "sumnjivo savršeno"; brisanje starih podataka (uređaji 24 mjeseca, tekst 12 mjeseci, bivši radnici); samostalno postavljanje lokala (ispod sat vremena bez Vedrana); spajanje i dijeljenje stavki, "Sto 5 · 2 računa"; grupe dodataka; obavještenja na telefon; prijedlozi narudžbe i "roba ispod minimuma" u "Admini"; "Za naručiti" s kvačicama; potvrda zamjena; utišavanje vrsta u Dnevniku; menadžer; drugi lokal; Viber. Kasnije: bonus, dobavljači i cijene, marže, slike Z-izvještaja, druga lokacija, fiskalizacija.

## 12. Odluke koje tražimo od vlasnika i Vedrana

1. **Gotovina (vlasnik):** svaki konobar svoj džep (preporučeno) ili jedna kasa? Drugo znači jednu predaju onoga ko zatvara i nestanak ličnih mjera gotovine.
2. **Šanker i uređaj na šanku (vlasnik):** šanker u svakoj smjeni? Zajednički tablet? Određuje ko odobrava, isplati li se "Priprema" i ko radi početni popis bez šankera (podrazumijevano prvi konobar, oko 5 minuta).
3. **Pravila procesa (vlasnik):** "nema ekrana = besplatno piće", "šanker sipa", tajni gost — tekst u Pravilima; "ne" ne mijenja aplikaciju.
4. **Pragovi (vlasnik):** 2 pića osoblja do 3 KM, tolerancija 5 KM / 1 %, otpis 10 KM / 20 KM, gratis 20 KM / 50 KM, šankerova storna 30 KM, isplate 50 KM, ± 15 % grama. Promjena je postavka i nova verzija Pravila.
5. **Nargila (vlasnik):** brendovi, arome, uglja po luli (3?) i za žar (2), cijene nove lule i žara, komada u kutiji; vaga (oko 30 KM) prije pilota.
6. **Lista brzog popisa (vlasnik):** potvrditi dvadesetak artikala; kafa, šećer i otvoren duhan su na njoj.
7. **Terminal (vlasnik):** postoji li i štampa li dnevni izvještaj? Bez njega "Kartica" nestaje; s njim vlasnik unosi ukupno.
8. **Radno vrijeme (vlasnik):** zatvaranje u 03:00? Ikad poslije 06:00? Određuje rano zatvaranje, početak dana i kraj šablona.
9. **Prijemi (vlasnik):** samo vlasnik (preporučeno) ili i šanker? Isto za slikanje otpremnica.
10. **Kanal upozorenja (vlasnik):** Telegram ili Viber? Pratiti napojnice (podrazumijevano ne)?
11. **Vlasništvo i server (Vedran + vlasnik):** server na vlasnikovo ime ili pisana bilješka; Vedranov server ili novi za 5 EUR; ime i ikona aplikacije — prije faze 1.
12. **Stolovi, zone, datum (vlasnik):** broj, imena, unutra/bašta; "08.09.2026." s tačkom?
13. **Entitet (vlasnik):** FBiH / RS / Brčko — određuje fiskalnu integraciju i rok zakona FBiH 2026.
14. **Obavještenje o podacima (vlasnik):** objaviti "Šta aplikacija bilježi" kako je napisano ili dati na provjeru po zakonu iz 2025.
15. **Kategorije (Vedran → vlasnik):** prava lista i raspodjela; do tada privremena.
16. **Čitanje otpremnica (vlasnik + Vedran):** čiji nalog drži ključ (preporučeno vlasnikov, oko 1 USD mjesečno) i je li prihvatljivo slati slike otpremnica vanjskom servisu; ako nije, prijem ostaje ručni.
17. **Vlasnički nalozi (vlasnik):** ko dobija nalog (ime, e-mail, telefon) i ko treba samo uvid prije faze 5.
18. **Šankerov razgovor (vlasnik):** u "Konobari" (podrazumijevano) ili u "Admini"? Jedna promjena.
19. **Čuvanje (vlasnik):** tekst 12 mjeseci, slike 90 dana, uređaji 24 mjeseca — prihvatljivo? Kraće je postavka; duže traži razlog u Pravilima.
20. **Konobari i slike (vlasnik):** pismeno obećanje da ne otvara "Konobari" u bazi (preporučeno da)? "Slike samo šanka, robe i prostora — gosti nikad"? Smiju li konobari brisati tuđi tekst (podrazumijevano ne; slike da)?
21. **Zamjene (vlasnik):** prihvaćena zamjena je konačna (podrazumijevano) ili vlasnik potvrđuje (faza 5)? Ko preuzima otvoren zahtjev — bilo ko ili samo konobari?
22. **Šabloni i plaća (vlasnik):** prava vremena, kasnija smjena vikendom, dnevnica ili po satu — određuje koja kolona "Sati" je osnova; dugme "Tu sam" (podrazumijevano ne).
23. **Sažetak razgovora na Telegram (vlasnik):** uopšte, i samo "Admini" (podrazumijevano) ili i "Svi"?
24. **Viber grupe (vlasnik + osoblje):** ugasiti nakon dvije sedmice pilota ili zadržati za privatno?
25. **Buka u Dnevniku (vlasnik, poslije pilota):** ako vlasnici prestanu čitati, rješenje je utišavanje vrsta u fazi 5, ne više Telegrama — reći rano ako je "Važno" već previše.

## 13. Rizici i kako ih ublažavamo

| # | Rizik | Ublažavanje |
|---|---|---|
| 1 | Ture se ne unose — put koji aplikacija ne vidi | unos brži od papira; vaganje na početku i kraju; grami i žar po luli; "šanker sipa"; tajni gost; prihod po satu |
| 2 | Telefoni izgube ili udvostruče ture | jedinstveni broj svake radnje; ture nakon zatvaranja vezane za smjenu; predaja provjerava sve telefone; ručni unos |
| 3 | Greška u kodu pokvari zapise | nepromjenjivost u bazi; sažeci s verzijama, pa noćno odstupanje znači grešku |
| 4 | Ukradeno odobrenje (PIN na tuđem telefonu) | vlasnik nikad ne kuca PIN na tuđem uređaju; šestocifreni PIN, oznaka tuđeg uređaja, ograničeno vrijeme, Telegram |
| 5 | Aplikacija postane oružje | Pravila s potvrdama; obostrana vidljivost; razlika nikad zamrznuta; ishodi razgovora; bez rang-liste; bez "vidjeli" |
| 6 | Rokovi se pomjere | faza 1 svedena na naručivanje i naplatu; pilot nakon faze 2; ostatak ekipe u fazi 3b; 240–325 sati (150–210 do pilota) |
| 7 | Server padne ili Vedran nije dostupan | automatsko pokretanje, upozorenja vlasniku, kopije svakog sata, vanjska kopija, mjesečna vježba povrata, uputstvo, druga osoba s ključevima |
| 8 | Popisi se namještaju | slijep unos, vaganje, čuvar po imenu, svjedok, obavezan početni popis, nasumični popisi, "sumnjivo savršeno" |
| 9 | Podaci o robi trunu | liste U minusu, Bez normativa, Bez cijene, Kasno sinhronizovano; manjak u KM od prvog dana |
| 10 | Zamjena za fiskalni uređaj | ništa se ne štampa, vodeni žig, bez PDV-a i numerisanja računa |
| 11 | Dijeljeni PIN-ovi i posuđeni telefoni | sesije vezane za uređaj, oznaka "posuđeno", zaključavanje, vlastite prijave u Moji podaci |
| 12 | Aplikacija se zakomplikuje | jedan proces, jedna datoteka, nepromjenjivi zapisi, jedno osvježavanje; testovi temelja kao ograda |
| 13 | Vlasnik koristi Viber | slanje ne zavisi od kanala; potvrditi prije faze 2 |
| 14 | Obaveze prema podacima osoblja | obavještenje u Pravilima; potvrde; inicijali u izvozu; brisanje starih podataka u fazi 3b i 5 |
| 15 | Otpremnica pogrešno pročitana | nikad se ne knjiži sama; svaka linija pred vlasnikom; slika ostaje; korekcija |
| 16 | Više vlasnika radi isto | druga odluka ne prolazi ("već odlučeno"); svaki red nosi ime; "Već promijenjeno — osvježi" |
| 17 | Slike gostiju, uznemiravanje ili novac u razgovoru | pravila o slikama i novcu; vlasnik briše i utišava; svako uklanja sliku u "Konobari"; "Prijavi vlasniku"; upozorenje o iznosima; 90 dana |
| 18 | Razgovor ometa naručivanje | poseban ekran, samo broj, bez zvuka; "narudžbe se zaključuju, ne pišu u Razgovor"; nacrt preživi odlazak u razgovor |
| 19 | Prostor i zloupotreba slika | 1280 px i 1,5 MB (1600 px, 2,5 MB otpremnice), dnevni i mjesečni limiti, slike bez poruke brišu se nakon 60 minuta |
| 20 | Dnevnik postane buka | "Važno" podrazumijevano, tihe vrste, odluka u kartici zahtjeva; utišavanje u fazi 5 |
| 21 | Raspored prepravljen naknadno ili bolovanje procuri | prošli datumi samo izostanak ili bolovanje, nikad uklanjanje; svaka izmjena zapis; osoblje ne vidi statuse |
| 22 | Rana "Završi smjenu" kao alibi | ture s predanog telefona; rani odlazak naspram rasporeda; "Predaješ gotovinu kad završiš, ne prije" |
