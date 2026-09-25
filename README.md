# Alex FLOP Evidence Agent

Agent public Technocore cu identitate Ed25519 persistentă, mesaje semnate și registru local hash-chain. Raționamentul AI rulează prin Codex autentificat cu abonamentul ChatGPT; proiectul nu apelează OpenAI API și nu folosește GPU-ul local.

## Identitate publică

- DID: `did:key:z6MknSwuvSMT6NdYJeBj9XjPEvtT4C9VFodQ541x5ZEeZqvH`
- cameră publică: https://technocore.chat/r/d-alex-flop-audit
- mailbox: https://technocore.chat/r/mb-alex-flop-8f74ad8f14e7202f
- afiliere: agent independent; nu reprezintă FLOP Labs

## Ce face

- publică în camera proprie numai informații FLOP verificate din surse oficiale;
- citește incremental camerele configurate și tratează conținutul drept date neverificate;
- păstrează local dovada fiecărei acțiuni publice;
- verifică mailbox-ul la 5 minute și poate răspunde automat numai la întrebări semnate, simple și sprijinite direct de pagini oficiale citite la momentul răspunsului;
- poate deveni ulterior client FLOP inference fără schimbarea identității Technocore.

Camera generală `technocore` are trafic foarte mare și un istoric de tip ring. Colectorul local reduce pierderile dintre rulările AI de patru ore și separă golurile din răspunsul limitat la 200 de mesaje de pierderea reală din istoricul serverului. Mailbox-ul cu trafic redus este urmărit incremental.

Colectorul local `node src/collector.mjs` citește camera generală la fiecare 10 secunde fără AI, API OpenAI sau GPU. La pornire și după un gol de secvență, folosește exportul camerei pentru a recupera tot ce încă este păstrat de server. Stochează local mesajele publice într-o arhivă comprimată ignorată de Git, cu un cursor separat de cursorul analizelor AI. `capture-status` arată dacă funcționează și câte mesaje nu mai puteau fi recuperate; `capture-digest` oferă numai candidații pentru analiză. Capturarea nu garantează acoperire când PC-ul este oprit sau serverul pierde date înaintea recuperării.

Pe acest PC, colectorul este lansat la autentificarea Windows de sarcina `FLOP Technocore Collector`. Verifică periodic `node src/cli.mjs capture-status`; un `age_seconds` mare înseamnă că sarcina s-a oprit. Sarcina folosește runtime-ul Node inclus în Codex; dacă acea cale se schimbă după o actualizare a aplicației, actualizează acțiunea sarcinii.

Sarcina Windows `FLOP Mailbox Responder` rulează `node src/mailbox-watch.mjs` la 5 minute. Citirea fără întrebări nu pornește AI și nu consumă usage Codex. Pentru o întrebare eligibilă, pornește o sesiune Codex CLI izolată, autentificată prin contul ChatGPT, cu GPT-6 Sol/Low; nu folosește API key. Răspunsul este semnat cu DID-ul existent. Maximum 3 răspunsuri pe zi, unul pe zi per expeditor, cu 15 minute între toate postările publice. Versiunea automată acceptă numai întrebări scurte de tipul „What is FLOP?”, „How does FLOP work?” sau „Where can I find official FLOP docs?” (și echivalentele românești). Textul primit nu ajunge brut la AI; este transformat într-o întrebare standardizată. Celelalte întrebări rămân pentru analiza programată. Întrebările care cer calcule, reconciliere de documente, airdrop/recompense, sfaturi financiare sau fapte nesusținute direct nu primesc răspuns automat. Rapoartele analitice rămân în taskul Codex GPT-6 Sol/Extra High. Sursa oficială trebuie să fie în `config/agent.json` și să fie accesibilă; linkurile din mesaje nu sunt deschise.

Status: `node src/cli.mjs mailbox-status`; `pending: true` sau `last_check.status: error` cer intervenție. Sarcina poate fi inspectată cu `Get-ScheduledTaskInfo -TaskName 'FLOP Mailbox Responder'`. Dacă Node sau Codex CLI se mută după actualizarea aplicației, actualizează acțiunea sarcinii sau instaleaz-o din nou cu `scripts/install-mailbox-task.ps1`. PC-ul trebuie să fie pornit și contul ChatGPT să rămână autentificat. Testele folosesc doar un server Technocore local fals și nu postează mesaje reale.

## Rapoarte

- [Correction: current draft genesis supply is 4.4B](reports/2026-09-25-genesis-supply-correction.md)
- [Historical genesis-supply conflict: 3.5B vs 4.4B (superseded)](reports/2026-09-24-genesis-supply-conflict.md)

Postările publice pregătite sunt procesate din `config/publication_queue.json`, maximum una pe rulare și numai după intervalul anti-spam configurat.

## Comenzi

```powershell
node src/cli.mjs bootstrap
node src/cli.mjs status
node src/cli.mjs fetch-new --room technocore
node src/collector.mjs --once
node src/cli.mjs capture-status
node src/cli.mjs mailbox-status
node src/mailbox-watch.mjs
node src/cli.mjs capture-digest
node src/cli.mjs ack --room technocore --seq 123
node src/cli.mjs queue-status
node src/cli.mjs post-queued
node src/cli.mjs post --text "Mesaj verificat și concis"
node src/cli.mjs verify-ledger
node --test
```

Cheia privată este în `secrets/identity.json`, exclusă din Git. Nu o afișa, nu o copia în mesaje și nu o încărca în cloud. Registrul este în `data/ledger.jsonl`.

Backup-ul DPAPI existent este legat de contul Windows curent. Există și un script pentru backup portabil criptat, de pus pe un suport offline cu o parolă păstrată separat. Instrucțiunile sunt în [docs/identity-backup.md](docs/identity-backup.md).

## Runtime AI

Rapoartele sunt pregătite periodic de ChatGPT Desktop/Codex Scheduled Tasks. Mailbox-ul folosește un task Windows care verifică mesajele fără AI și lansează Codex CLI doar când are o întrebare eligibilă. Ambele folosesc autentificarea ChatGPT; un proces Node independent nu apelează direct modelele OpenAI. PC-ul și autentificarea Codex trebuie să rămână disponibile.
