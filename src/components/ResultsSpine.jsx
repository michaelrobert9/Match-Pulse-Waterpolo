import React from 'react'

// Results spine — the signature fixture-group ladder (fixture-groups brief
// §"Results ladder"). Every score sits on a centre spine; a short bar leans
// toward the winner, sized by goal margin and capped so a 9-0 doesn't run off
// the edge. The point is to read which way the day went at a glance, from the
// side of a pitch, without reading the numbers.
//
// CANONICAL — authored by netball and copied VERBATIM into hockey, rugby and
// water polo, like teamAccent.js and pom.js. Self-contained: React only, no
// repo imports. Colours arrive as props already passed through teamAccent() —
// there is no second colour path. Rows are real <a href> so the links render
// in the HTML for crawlers (brief §SEO). Live red (#E5484D) is used ONLY for
// live state.
//
// Props:
//   rows: [{ key, ageLabel, href, status, homeScore, awayScore, time, venue }]
//     status: 'final' | 'live' | 'paused' | 'scheduled' | 'postponed' | 'cancelled'
//   homeColor, awayColor: teamAccent() outputs for the group's two schools.

const MAX_MARGIN = 9   // a 9-0 fills the bar; larger margins are capped, never overflowed

function marginWidth(diff) {
  const m = Math.min(Math.abs(diff), MAX_MARGIN)
  if (m === 0) return '0%'
  // 12% floor so a one-goal win is visible; linear to 100% at the cap.
  return `${Math.round((0.12 + (m / MAX_MARGIN) * 0.88) * 100)}%`
}

export default function ResultsSpine({
  rows = [],
  homeColor = '#7B1E3C',
  awayColor = '#1B3B6F',
  drawColor = '#7C8B85',
  lineColor = '#E2E7E4',
  live = '#E5484D',
}) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${lineColor}`, borderRadius: 10, overflow: 'hidden' }}>
      {rows.map((r, i) => {
        const played = r.status === 'final'
        const isLive = r.status === 'live' || r.status === 'paused'
        const hs = Number(r.homeScore ?? 0)
        const as = Number(r.awayScore ?? 0)
        const homeWin = played && hs > as
        const awayWin = played && hs < as
        const draw = played && hs === as
        const w = marginWidth(hs - as)
        const last = i === rows.length - 1

        let statusText = 'TBC'
        if (played) statusText = 'FT'
        else if (isLive) statusText = r.time || 'Live'
        else if (r.time) statusText = r.time

        const inner = (
          <>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: 13, letterSpacing: '-.01em' }}>{r.ageLabel}</div>
            <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 8 }}>
              <div aria-hidden style={{ position: 'absolute', left: '50%', top: -13, bottom: -13, width: 1, background: lineColor, transform: 'translateX(-.5px)' }} />
              {homeWin
                ? <div style={{ justifySelf: 'end', height: 6, borderRadius: 3, width: w, background: homeColor, position: 'relative', zIndex: 1 }} />
                : draw
                  ? <div style={{ justifySelf: 'end', height: 6, borderRadius: 3, width: 14, background: drawColor, position: 'relative', zIndex: 1 }} />
                  : <div style={{ height: 6 }} />}
              {played
                ? <div style={{ fontFamily: 'Roboto', fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: 15, letterSpacing: '-.01em', position: 'relative', zIndex: 2, background: '#fff', padding: '0 7px' }}>
                    <span style={homeWin ? { color: homeColor } : undefined}>{hs}</span>
                    <span style={{ color: drawColor, fontWeight: 400, padding: '0 1px' }}>–</span>
                    <span style={awayWin ? { color: awayColor } : undefined}>{as}</span>
                  </div>
                : <div style={{ fontFamily: 'Inter', fontWeight: 500, fontSize: 11, color: isLive ? live : drawColor, letterSpacing: '.08em', position: 'relative', zIndex: 2, background: '#fff', padding: '0 7px', whiteSpace: 'nowrap' }}>
                    {isLive ? 'LIVE' : ([r.time, r.venue].filter(Boolean).join(' · ') || '—')}
                  </div>}
              {awayWin
                ? <div style={{ justifySelf: 'start', height: 6, borderRadius: 3, width: w, background: awayColor, position: 'relative', zIndex: 1 }} />
                : <div style={{ height: 6 }} />}
            </div>
            <div style={{ textAlign: 'right', fontSize: 12, color: isLive ? live : drawColor, fontFamily: (played || isLive) ? 'Roboto' : 'Inter', fontVariantNumeric: 'tabular-nums' }}>
              {statusText}
            </div>
          </>
        )

        const rowStyle = {
          display: 'grid', gridTemplateColumns: '64px 1fr 64px', alignItems: 'center', gap: 8,
          padding: '12px 16px', borderBottom: last ? 'none' : `1px solid ${lineColor}`,
          color: 'inherit', textDecoration: 'none',
        }
        return r.href
          ? <a key={r.key ?? i} href={r.href} style={rowStyle}>{inner}</a>
          : <div key={r.key ?? i} style={rowStyle}>{inner}</div>
      })}
    </div>
  )
}
