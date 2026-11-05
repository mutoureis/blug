import type {MetaFunction} from '@remix-run/node'
import {Link} from '@remix-run/react'

// GANTI dengan emailmu yang aktif. Alamat ini tampil publik di halaman.
const CONTACT_EMAIL = 'EMAILMU@gmail.com'
const UPDATED = '5 November 2026'

export const meta: MetaFunction = () => [
  {title: 'Kebijakan Privasi · mutho.'},
  {name: 'description', content: 'Data apa yang dikumpulkan blog mutho.my.id dan bagaimana data itu digunakan.'},
]

function H2({children}: {children: React.ReactNode}) {
  return <h2 className="font-display text-[22px] mt-10 mb-3 text-[#f0f0f0]">{children}</h2>
}

function P({children}: {children: React.ReactNode}) {
  return <p className="text-[#c8c8c8] leading-relaxed mb-3">{children}</p>
}

function UL({children}: {children: React.ReactNode}) {
  return <ul className="list-disc pl-5 space-y-1.5 text-[#c8c8c8] leading-relaxed mb-3">{children}</ul>
}

export default function Privacy() {
  return (
    <div className="mx-auto w-full max-w-[720px] px-6 py-12 sm:py-16">
      <h1 className="font-display text-[34px] mb-2">Kebijakan Privasi</h1>
      <p className="font-mono text-xs text-[#888] mb-8">Terakhir diperbarui: {UPDATED}</p>

      <P>
        Blog <b>mutho.</b> (https://mutho.my.id) dikelola secara pribadi. Halaman ini menjelaskan data apa yang
        diproses saat kamu membaca blog dan saat kamu berkomentar.
      </P>

      <H2>1. Membaca blog tanpa login</H2>
      <P>Kamu tidak perlu akun untuk membaca. Saat kamu membuka situs:</P>
      <UL>
        <li>
          <b>Penghitung pengunjung unik.</b> Alamat IP-mu tidak disimpan. Yang tersimpan hanya hash satu arah dari
          kombinasi IP, user agent, dan garam rahasia, di struktur data yang hanya bisa menghitung jumlah pengunjung
          unik dan tidak bisa dibaca ulang. Browser juga menyimpan penanda <code>visit-counted</code> di
          sessionStorage agar kunjunganmu tidak dihitung berulang dalam satu sesi tab.
        </li>
        <li>
          <b>Tidak ada analytics atau iklan.</b> Situs ini tidak memakai Google Analytics, pelacak iklan, atau cookie
          pemasaran.
        </li>
        <li>
          <b>Hosting.</b> Situs dijalankan di platform hosting (Vercel), yang bisa mencatat log teknis standar seperti
          alamat IP dan user agent untuk keamanan dan operasional.
        </li>
      </UL>

      <H2>2. Berkomentar dengan akun Google</H2>
      <P>
        Untuk menulis komentar, kamu wajib masuk dengan Google (Google Identity Services). Dari Google, kami hanya
        menerima <b>alamat email</b> dan <b>nama</b> akunmu. Kami tidak meminta dan tidak mengakses data Google lain
        seperti kontak, Drive, kalender, atau foto. Kata sandi Google-mu tidak pernah sampai ke kami.
      </P>
      <P>Saat kamu berkomentar, data berikut disimpan:</P>
      <UL>
        <li>
          <b>Nama</b> dan <b>isi komentar</b> beserta waktunya. Ini ditampilkan secara publik di bawah tulisan.
        </li>
        <li>
          <b>Alamat email</b>. Ini bersifat privat: tidak ditampilkan di situs dan tidak dikirim ke browser
          pengunjung lain. Email dipakai untuk notifikasi balasan (lihat bagian 3).
        </li>
        <li>
          <b>Pembatas laju.</b> Untuk mencegah spam, alamat IP dan email-mu dipakai sebagai kunci penghitung
          sementara (maksimal 3 komentar per menit dan 30 per hari). Penghitung ini otomatis terhapus dalam waktu
          paling lama 24 jam.
        </li>
        <li>
          <b>Cookie sesi</b> bernama <code>cm_session</code>. Cookie ini berisi emailmu dan namamu, ditandatangani agar
          tidak bisa dipalsukan, bersifat HttpOnly, dan berlaku 30 hari atau sampai kamu keluar. Cookie ini
          dibutuhkan agar kamu tetap masuk, dan bukan cookie pelacak.
        </li>
      </UL>

      <H2>3. Email notifikasi</H2>
      <UL>
        <li>
          Saat ada yang membalas komentarmu, kami mengirim email ke alamat Google-mu lewat layanan pengiriman email{' '}
          <b>Resend</b>. Isi email memuat nama pembalas, isi balasan, dan tautan ke tulisan.
        </li>
        <li>Setiap email memuat tautan <b>Berhenti menerima notifikasi</b>. Satu klik sudah cukup untuk mematikannya.</li>
        <li>
          Pemilik blog menerima email setiap ada komentar baru, termasuk nama dan email pengomen, supaya bisa
          membalas.
        </li>
      </UL>

      <H2>4. Layanan pihak ketiga</H2>
      <P>
        Saat halaman dimuat, browser-mu bisa berhubungan langsung dengan layanan berikut, yang dapat melihat alamat IP
        dan data teknis browser-mu sesuai kebijakan masing-masing:
      </P>
      <UL>
        <li>
          <b>Google</b> (Sign in with Google, di halaman yang memuat komentar, dan Google Fonts untuk huruf).
        </li>
        <li>
          <b>Bluesky</b> (gambar dari CDN Bluesky dan, di beberapa tulisan, tayangan embed postingan Bluesky).
        </li>
        <li>
          <b>Spotify</b> (sampul album) dan <b>Lanyard/Discord</b> (status online) untuk widget &ldquo;sedang
          mendengarkan&rdquo; dan status Discord milik pemilik blog. Widget ini menampilkan aktivitas pemilik blog,
          bukan datamu.
        </li>
      </UL>

      <H2>5. Penggunaan dan pembagian data</H2>
      <P>
        Data dipakai hanya untuk menampilkan komentar, mengirim notifikasi balasan, mencegah spam, dan menghitung
        jumlah pengunjung. Data tidak dijual, tidak dipakai untuk iklan, dan tidak dibagikan ke pihak lain selain
        penyedia layanan yang disebut di atas yang dibutuhkan untuk menjalankan fitur ini.
      </P>

      <H2>6. Penyimpanan dan penghapusan</H2>
      <UL>
        <li>Komentar dan emailmu disimpan selama komentar itu ada di blog.</li>
        <li>
          Untuk menghapus komentar atau datamu, kirim email ke{' '}
          <a className="text-[#4a9eff] underline" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          . Sebutkan tulisan dan komentar yang dimaksud.
        </li>
        <li>
          Kamu bisa mencabut akses akun Google kapan saja di{' '}
          <a className="text-[#4a9eff] underline" href="https://myaccount.google.com/permissions" rel="noreferrer">
            myaccount.google.com/permissions
          </a>
          , dan menghapus cookie sesi dengan klik keluar atau menghapus cookie browser.
        </li>
      </UL>

      <H2>7. Perubahan kebijakan</H2>
      <P>Kalau ada perubahan pada cara data diproses, halaman ini akan diperbarui dan tanggal di atas diubah.</P>

      <H2>8. Kontak</H2>
      <P>
        Pertanyaan tentang kebijakan ini:{' '}
        <a className="text-[#4a9eff] underline" href={`mailto:${CONTACT_EMAIL}`}>
          {CONTACT_EMAIL}
        </a>
      </P>

      <p className="mt-12 font-mono text-sm">
        <Link to="/" className="text-[#4a9eff]">
          ← mutho.my.id
        </Link>
      </p>
    </div>
  )
}
