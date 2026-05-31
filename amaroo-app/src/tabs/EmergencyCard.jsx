import { Printer } from 'lucide-react'

function Row({ label, value }) {
  return (
    <tr className="border-b border-slate-100 last:border-0">
      <td className="py-2 pr-4 font-medium text-slate-600 whitespace-nowrap align-top w-2/5">{label}</td>
      <td className="py-2 text-slate-900 font-semibold">{value}</td>
    </tr>
  )
}

function Section({ emoji, title, rows }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow print:shadow-none print:rounded-none print:border print:border-slate-300">
      <h2 className="font-bold text-base text-[#0A4A52] mb-3 border-b-2 border-[#0A4A52] pb-1">
        {emoji} {title}
      </h2>
      <table className="w-full text-sm">
        <tbody>
          {rows.map(([label, value]) => (
            <Row key={label} label={label} value={value} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function EmergencyCard() {
  return (
    <div className="space-y-4 max-w-2xl">
      <style>{`
        @media print {
          aside, nav, header, .no-print { display: none !important; }
          main { padding: 0 !important; }
          body { background: white !important; }
          .print\\:shadow-none { box-shadow: none !important; }
        }
      `}</style>

      <div className="flex items-center justify-between no-print">
        <h2 className="font-serif text-2xl text-[#0A4A52]">Emergency Card</h2>
        <button
          type="button"
          onClick={() => window.print()}
          className="flex items-center gap-2 rounded-lg bg-[#0A4A52] text-white px-4 py-2 text-sm"
        >
          <Printer size={16} />
          Print / Save as PDF
        </button>
      </div>

      <Section
        emoji="🚨"
        title="VESSEL DETAILS"
        rows={[
          ['Vessel Name', 'Amaroo'],
          ['Type', 'Clipper Explorer 50 PH'],
          ['Registration', 'BZI70Q (expires 28/05/2026)'],
          ['MMSI', '503106120'],
          ['Home Berth', 'Aquatic Paradise, Brisbane'],
          ['Engines', 'Twin Cummins QSB 6.7 480HP'],
        ]}
      />

      <Section
        emoji="📡"
        title="DISTRESS & COMMUNICATION"
        rows={[
          ['VHF Distress', 'Channel 16'],
          ['Fixed VHF', 'Raymarine R70370'],
          ['Handheld VHF', 'Raymarine RS-38M'],
          ['AIS', 'Raymarine AIS700 — MMSI 503106120'],
          ['Maritime Emergency', '1800 641 792 (AMSA 24/7)'],
          ['VMR Queensland', 'VHF Ch16 / 1300 369 003'],
        ]}
      />

      <Section
        emoji="🛟"
        title="SAFETY EQUIPMENT"
        rows={[
          ['Life Raft', 'Viking (next service 01/06/2028)'],
          ['Lifejackets', '2× Spinlock Lite (service May 2027)'],
          ['PLB 1', 'Ocean Signal PLB1'],
          ['PLB 2', 'Ocean Signal PLB1'],
          ['MOB 1', 'Ocean Signal MOB1'],
          ['MOB 2', 'Ocean Signal MOB1'],
          ['Flares', 'P/Wessex'],
        ]}
      />

      <Section
        emoji="🏥"
        title="EMERGENCY CONTACTS"
        rows={[
          ['Emergency Contact 1', '—'],
          ['Emergency Contact 2', '—'],
          ['Doctor / Medical', '—'],
        ]}
      />

      <Section
        emoji="🛡️"
        title="INSURANCE"
        rows={[
          ['Insurer', 'Anchorage Marine / QBE'],
          ['Policy', 'AM024374'],
          ['Expires', '19/05/2026'],
          ['Claims', '(owner to add phone number)'],
        ]}
      />

      <Section
        emoji="⚓"
        title="VESSEL POSITION / NAVIGATION"
        rows={[
          ['Chart Plotter', 'Raymarine E165 MFD'],
          ['Home Berth Lat/Lng', '-27.524, 153.430'],
        ]}
      />
    </div>
  )
}
