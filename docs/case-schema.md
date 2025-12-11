# Vaka JSON Şeması ve Firestore Eşlemesi

Bu doküman, `data/cases.json` ve `data/sample_case_template.json` dosyalarında kullanılan vaka şemasını, zorunlu/opsiyonel alanları ve Firestore koleksiyon yapısını tanımlar.

## Zorunlu Alanlar
Her vaka (case) kaydı için bulunması gereken alanlar:

- `id` _(string)_: Benzersiz vaka anahtarı. Firestore doküman ID'si olarak da kullanılır.
- `title` _(string)_: Vaka adı.
- `difficulty` _(string)_: `kolay | orta | zor` değerlerinden biri.
- `tags` _(string[])_: En az bir konu etiketi.
- `patient` _(object)_: Hasta bilgisi.
  - `age` _(number)_
  - `sex` _("E" | "K")_
  - `setting` _(string)_: `ambulans`, `acil` vb.
  - `triage` _(string)_: Örn. `kırmızı`, `sarı`.
- `story` _(string)_: Klinik hikaye.
- `exam` _(object)_: Muayene bulguları.
  - `vitals` _(string)_
  - `physical` _(string)_
- `final_diagnosis` _(string)_: Nihai tanı.
- `scoring` _(object)_: Oyunlaştırma puan şeması.
  - `base` _(number)_
  - `penalty_per_lab` _(number)_
  - `penalty_per_imaging` _(number)_
  - `penalty_per_procedure` _(number)_
  - `bonus_correct_dx` _(number)_

> Bu alanlar eksikse `js/vaka-edit.js` içindeki doğrulama uyarı verir ve dışa aktarılan JSON geçersiz sayılır.

## Opsiyonel Alanlar
- `paramedic` _(string)_: Olay yeri/ilk değerlendirme notu.
- `labs`, `imaging`, `procedures` _(object)_: Anahtar-değer çiftleri. Eksik tetkik/görüntüleme için mutlaka `default` alanı tutulur.
- `drugs` _(array)_: { `name`, `doses`[], `response` } nesneleri.
- `consults` _(string[])_: İstenen branşlar.
- `disposition` _(string)_: Nakil/stabilizasyon planı.
- `media` _(object)_: Vaka ile ilişkili medya yolları.
  - `cover_image` _(string)_: Kart/hero görseli. Varsayılan: `media/defaults/case-hero.jpg`.
  - `ekg_image` _(string | null)_: EKG görseli. Varsayılan: `media/defaults/ekg-placeholder.png`.
  - `imaging_gallery` _(string[])_: Bir veya daha fazla görüntüleme görseli. Varsayılan: `[]` veya `media/defaults/xray-placeholder.png` benzeri yollar.
  - `audio_note` _(string | null)_: Radyo kaydı vb.; yoksa `null`.

## Varsayılan Medya Referansları

- Hero görseli: `media/defaults/case-hero.jpg`
- EKG görseli: `media/defaults/ekg-placeholder.png`
- Akciğer/FAST/Pelvis vb. şablon görseli: `media/defaults/xray-placeholder.png`, `media/defaults/fast-placeholder.png`, `media/defaults/pelvis-placeholder.png`
- EMS radyo örneği: `media/defaults/ems-radio.mp3`

Gerçek dosyalar henüz ekli değil; bu yollar, istemcinin kendi varlıklarını eklemesi için yer tutucu olarak kullanılır.

## Firestore Koleksiyon Yapısı

```
cases (collection)
  └── {caseId} (document)
        id: string         // caseId ile aynı tutulur
        title: string
        difficulty: string
        tags: string[]
        patient: {
          age: number
          sex: string
          setting: string
          triage: string
        }
        paramedic: string
        story: string
        exam: {
          vitals: string
          physical: string
        }
        labs: map<string, string>
        imaging: map<string, string>
        procedures: map<string, string>
        media: {
          cover_image: string
          ekg_image: string | null
          imaging_gallery: string[]
          audio_note: string | null
        }
        drugs: [
          {
            name: string
            doses: string[]
            response: string
          }
        ]
        consults: string[]
        disposition: string
        final_diagnosis: string
        scoring: {
          base: number
          penalty_per_lab: number
          penalty_per_imaging: number
          penalty_per_procedure: number
          bonus_correct_dx: number
        }

config (collection)
  └── featured_case (document)
        featured_case_id: string
```

- Firestore tarafında `cases` koleksiyonu, JSON dosyasındaki `cases` dizisiyle birebir eşleşir.
- `featured_case_id` değeri `config/featured_case` dokümanında tutulur; istemci bu değerle öne çıkan vakayı seçer.
- Medya yolları string olarak tutulur; CDN ya da Storage URL’leri ile değiştirilebilir.

## Örnekler

- Tamamlanmış üretim verisi: [`data/cases.json`](../data/cases.json)
- Şablon/taslak: [`data/sample_case_template.json`](../data/sample_case_template.json)
