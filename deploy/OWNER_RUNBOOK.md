# Šank — šta uraditi kad nešto ne radi

**Odštampaj ovu stranicu i zalijepi je u ormarić iza šanka.**

Ovo nije fiskalni uređaj. Šank je interna evidencija narudžbi, smjena i robe.

---

## 1. Aplikacija ne radi

**Uzmi papirni blok i nastavi raditi. Ništa se ne gubi.**

Konobari pišu ture na papir kao i prije. Kad se aplikacija vrati, sve se unese
naknadno i smjena se normalno zatvori.

Sve što je upisano prije kvara je sačuvano — ništa nije nestalo. Nemoj ništa
brisati, nemoj instalirati aplikaciju ponovo i nemoj mijenjati postavke na
telefonima. Samo papir, pa nazovi (tačka 4).

Ako ne radi samo jednom konobaru, a ostalima radi — nije server. Neka taj
telefon isključi i uključi internet, pa proba ponovo.

---

## 2. Kako se aplikacija restartuje

Na laptopu otvori **Terminal** i prekopiraj tačno ovu liniju, pa pritisni Enter:

```
ssh sank@___.___.___.___ 'sudo systemctl restart sank'
```

Sačekaj pola minute, pa probaj otvoriti aplikaciju na telefonu.

Ako radi — gotovo, nastavi normalno.
Ako ne radi, ako te išta pita, ili ako ti nije jasno — **stani i zovi Vedrana.**
Nemoj dalje ništa kucati. Papirni blok radi dok se ne javi.

---

## 3. Kopija baze

Server sam pravi kopiju **svakog sata** i još jednu **svaki dan u 5 ujutru**.
Ti ne moraš ništa raditi. Kopije stoje na serveru u `/opt/sank/backups`.

Kad ti treba kopija kod sebe (na primjer prije neke veće izmjene), na laptopu u
Terminalu:

```
scp sank@___.___.___.___:/opt/sank/backups/daily/*.db ~/Desktop/
```

### ⚠️ Ta datoteka je ključ od kase

U njoj je **sve**: sve pare, sve smjene, sve što je ko prodao i svi PIN-ovi.
Ko je ima — ima cijelu kafanu na svom kompjuteru, zauvijek.

- **Čuvaj je kao ključ od kase.**
- **Nikad** je ne šalji preko Vibera, WhatsAppa, Telegrama ni e-maila. Te
  datoteke ostaju na tuđim serverima i lako se proslijede greškom.
- Drži je na svom računaru i obriši je čim ti više ne treba.
- Ne ostavljaj je na USB-u koji stoji u lokalu.

---

## 4. Koga zvati

| Ko | Za šta | Broj |
|---|---|---|
| Vedran | aplikacija, server, sve ovo gore | ____________________ |
| ____________________ | zamjena kad Vedran nije dostupan | ____________________ |
| ____________________ | internet u lokalu | ____________________ |
| ____________________ | firma kod koje je server | ____________________ |

Kad zoveš, reci tri stvari: **šta si radio**, **šta piše na ekranu**, i **da li
ne radi svima ili samo jednom telefonu.**

---

*Nema te greške u aplikaciji koja se ne može ispraviti sutra. Papir i olovka su
uvijek rezervni plan.*
