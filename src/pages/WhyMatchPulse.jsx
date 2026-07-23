import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import './WhyMatchPulse.css'

export default function WhyMatchPulse() {
  useEffect(() => {
    const page = document.querySelector('.mp-page')
    if (!page) return
    const items = page.querySelectorAll('.reveal')
    if (!('IntersectionObserver' in window)) {
      items.forEach(el => el.classList.add('in'))
      return
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) }
      })
    }, { threshold: 0.12 })
    items.forEach((el, i) => {
      el.style.transitionDelay = `${Math.min(i % 6, 5) * 60}ms`
      io.observe(el)
    })
    return () => io.disconnect()
  }, [])

  return (
    <main className="mp-page">

      {/* HERO */}
      <section className="hero">
        <div className="wrap">
          <div className="eyebrow"><span className="dot" />Live match tracking</div>
          <h1>Every match.<br />On the record.</h1>
          <p className="lede">Create fixtures, score live, and publish results the moment the whistle goes. Built for school and club hockey.</p>
          <div className="hero-ctas">
            <Link to="/signup" className="btn btn-primary">Start scoring</Link>
          </div>
          <p className="hero-foot">No spreadsheets. No paper. No &ldquo;what was the score again?&rdquo;</p>

          {/* Static live scoreboard illustration */}
          <div className="board" aria-label="Example live match">
            <div className="board-top">
              <span className="pill pill-live">&#9679; Live</span>
              <span className="pill-phase">Q3 · 14:22</span>
            </div>
            <div className="board-grid">
              <div className="team">
                <div className="crest a">RG</div>
                <div className="team-name">Rustenburg Girls</div>
              </div>
              <div className="score tnum">
                <span className="num">4</span>
                <span className="sep" />
                <span className="num">2</span>
              </div>
              <div className="team">
                <div className="crest b">HS</div>
                <div className="team-name">Herschel School</div>
              </div>
            </div>
            <div className="ticker tnum">
              <span><b>34&apos;</b> Goal · Rustenburg</span>
              <span><b>28&apos;</b> Green card · Herschel</span>
              <span><b>21&apos;</b> Goal · Herschel</span>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="mp-section" id="how">
        <div className="wrap">
          <p className="label reveal">From first whistle to final table</p>
          <h2 className="h2 reveal">Three steps. One source of truth.</h2>
          <div className="flow">
            <div className="step reveal">
              <span className="line" />
              <span className="idx tnum">01</span>
              <h3>Create a fixture</h3>
              <p>Set the teams, date, and venue. MatchPulse handles the rest.</p>
            </div>
            <div className="step reveal">
              <span className="line" />
              <span className="idx tnum">02</span>
              <h3>Score it live</h3>
              <p>Tap to add goals and cards as they happen. The clock, the quarters and the scoreline update in real time on every screen watching.</p>
            </div>
            <div className="step reveal">
              <span className="line" />
              <span className="idx tnum">03</span>
              <h3>Publish instantly</h3>
              <p>The moment you hit full time, the result is on the record, feeding competitions, team pages, and player stats automatically.</p>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="mp-section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <p className="label reveal">What&rsquo;s inside</p>
          <h2 className="h2 reveal">Everything a fixture needs, in one place.</h2>
          <p className="sub reveal">Built for coaches on the sideline, organisers in the office, and parents on the stand.</p>
          <div className="features">
            <div className="feat reveal">
              <div className="ico">⏱</div>
              <h3>Live scoring console</h3>
              <p>A pitch-side console built for one-handed tapping. Quarters, clock, goals and cards. Big targets, no fumbling.</p>
            </div>
            <div className="feat reveal">
              <div className="ico">▦</div>
              <h3>Competitions that run themselves</h3>
              <p>Build draws and competitions that organise themselves. Every fixture rolls into the right league, season and table.</p>
            </div>
            <div className="feat reveal">
              <div className="ico">⬢</div>
              <h3>A page for every team</h3>
              <p>One home for every team. Schools, clubs and age groups, with crests, squads and a full match history.</p>
            </div>
            <div className="feat reveal">
              <div className="ico">↗</div>
              <h3>Instant publishing</h3>
              <p>Results go public the second the whistle blows. No exports, no waiting, no end-of-day admin.</p>
            </div>
            <div className="feat reveal">
              <div className="ico">▤</div>
              <h3>Live tables</h3>
              <p>Standings recalculate automatically off real results. Always current, never a stale spreadsheet.</p>
            </div>
            <div className="feat reveal">
              <div className="ico">◷</div>
              <h3>Every result, on the record</h3>
              <p>Every goal, card and final score, kept permanently. Look back at any fixture, any season, any time.</p>
            </div>
          </div>
        </div>
      </section>

      {/* RECORD STRIP */}
      <section className="mp-section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="record reveal">
            <div className="big tnum">0<small>sec</small></div>
            <p>That&rsquo;s the gap between the final whistle and a published result. The match is on the record before you&rsquo;ve left the pitch.</p>
          </div>
        </div>
      </section>

      {/* AUDIENCE SPLIT */}
      <section className="mp-section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <p className="label reveal">Made for two sides of the game</p>
          <h2 className="h2 reveal">Built for the sideline. Loved from the stands.</h2>
          <div className="split">
            <div className="aud reveal">
              <span className="tag">For schools &amp; clubs</span>
              <h3>Run your season without the spreadsheet.</h3>
              <ul>
                <li>Create and manage every fixture from one dashboard.</li>
                <li>Score live and publish the instant it&rsquo;s done.</li>
                <li>Give every team a page worth sending to parents.</li>
              </ul>
            </div>
            <div className="aud reveal">
              <span className="tag">For the hockey community</span>
              <h3>Never miss a score.</h3>
              <ul>
                <li>Live scores from every fixture, not just the ones you&rsquo;re at.</li>
                <li>Standings that update the moment a result goes in.</li>
                <li>Every result and season, permanently on the record.</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* CLOSING CTA */}
      <section className="close" id="start">
        <div className="wrap">
          <h2 className="reveal">Create your first fixture today.</h2>
          <p className="reveal">Free to start. No card required. Your results on the record from day one.</p>
          <div className="hero-ctas reveal">
            <Link to="/signup" className="btn btn-primary">Create a free account</Link>
            <Link to="/plans" className="btn btn-ghost">See plans</Link>
          </div>
        </div>
      </section>

    </main>
  )
}
