# acil-x
Acil Servis Simulasyonu

## Vaka Verisi

- JSON şeması ve Firestore eşlemesi: [docs/case-schema.md](docs/case-schema.md)
- Örnek veri: [data/cases.json](data/cases.json)
- Şablon: [data/sample_case_template.json](data/sample_case_template.json)
- Firebase yapılandırması: [docs/firebase-setup.md](docs/firebase-setup.md)

## Oturum ve katılımcı akışı

1. **Sunucu/Host** `host.html` üzerinden bir oturum kodu ile Firestore’a bağlanır ve QR kodu ya da bağlantıyı öğrencilerle paylaşır.
2. **Öğrenciler** telefonlarından QR’ı okutup `player.html` sayfasına gider, kendi kullanıcı adını/nick’ini yazar ve kaydeder.
3. Her öğrenci seçtiği vakayı kendi başına çözer; işlem adımları ve puanları Firestore’a öğrenci bazlı kaydedilir.
4. Host paneli, canlı skor tablosunda her öğrencinin adını/nick’ini ve puanını ayrı satırlar halinde gösterir.
