# Firebase yapılandırması

Firestore kullanan host paneli ve skor senkronizasyonu için Firebase projesine ait web yapılandırmasını sağlamanız gerekir.

## Adımlar
1. Firebase konsolunda (Ayarlar → Genel) "Firebase SDK snippet" bölümündeki web yapılandırmasını kopyalayın.
2. `js/config.js` dosyasındaki `PLACEHOLDER_FIREBASE_CONFIG` alanlarını kendi proje bilgilerinizle doldurun **veya** aşağıdaki gibi ayrı bir dosyada global olarak tanımlayın:

```html
<!-- vaka.html içinde, vaka.js yüklenmeden önce -->
<script>
  window.FIREBASE_CONFIG = {
    apiKey: '...'
    authDomain: '...'
    projectId: '...'
    storageBucket: '...'
    messagingSenderId: '...'
    appId: '...'
  };
</script>
```

> Not: Boş veya eksik alanlar Firestore entegrasyonunu devre dışı bırakır ve host paneli pasif kalır.

## Hızlı doğrulama
- Sayfa yüklenince konsolda `Firebase config bulunamadı veya eksik; Firestore servisleri pasif.` uyarısı görmüyorsanız yapılandırma okunmuştur.
- Host panelindeki durum yazısı "Firestore oturumuna bağlanıldı." şeklinde güncellenmelidir.

## Debug modu
- URL'ye `?firebaseDebug=1` ekleyerek (veya global `window.FIREBASE_DEBUG = true` ayarlayarak) ayrıntılı konsol logları açılır.
- Geçersiz alanlar, seçilen yapılandırma kaynağı ve Firestore bağlantı hataları konsola yazılır; durum satırlarında da hata mesajı görünür.
