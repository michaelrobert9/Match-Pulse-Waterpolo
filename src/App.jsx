import { lazy, useState, useEffect } from 'react'
import { Routes, Route, Navigate, useParams } from 'react-router-dom'
import { fetchMatchGroup } from './lib/queries'
import { AuthProvider } from './contexts/AuthContext'
import LazyBoundary from './components/LazyBoundary'
import Layout from './components/Layout'
import AdminLayout from './components/AdminLayout'
import ProtectedRoute from './components/ProtectedRoute'
import SiteSettingsProvider from './components/SiteSettingsProvider'

// Public pages
import Home from './pages/Home'
import CompetitionsListPage from './pages/CompetitionsList'
import OrgList from './pages/OrgList'
import OrgDetail from './pages/OrgDetail'
import Browse from './pages/Browse'
import PlayersList from './pages/PlayersList'
import PlayerPage from './pages/PlayerPage'
import PlayerProfile from './pages/PlayerProfile'
import MatchDetail from './pages/MatchDetail'
import MatchGroupPage from './pages/MatchGroupPage'
import CreateMatchGroup from './pages/fixtures/CreateMatchGroup'
import MatchTimesGrid from './pages/fixtures/MatchTimesGrid'
import CompetitionOverview from './pages/CompetitionOverview'
import CompetitionStandings from './pages/CompetitionStandings'
import CompetitionFixtures from './pages/CompetitionFixtures'
import CompetitionPools from './pages/CompetitionPools'
import CompetitionKnockout from './pages/CompetitionKnockout'
import CompetitionFestivalStats from './pages/CompetitionFestivalStats'
import TeamDetail from './pages/TeamDetail'
import Login from './pages/Login'
import Signup from './pages/Signup'
import Profile from './pages/Profile'
import LegalPage from './pages/legal/LegalPage'
import Contact from './pages/Contact'
import NotFound from './pages/NotFound'

import InstallHelp from './pages/InstallHelp'

// Authenticated route groups (manage, scorer, admin) are lazy-loaded so the
// initial bundle a public visitor downloads doesn't include the large manager/
// admin/scoring screens. Each ships as its own chunk, fetched on first visit.
// Manage pages (org owners, staff, self-service)
const ManageHub  = lazy(() => import('./pages/manage/Hub'))
const CompetitionManage = lazy(() => import('./pages/manage/competitions/CompetitionManage'))
const CompetitionsManageList = lazy(() => import('./pages/manage/competitions/CompetitionsList'))
const CreateCompetition = lazy(() => import('./pages/manage/competitions/CreateCompetition'))
const OrgManage  = lazy(() => import('./pages/manage/OrgManage'))
const CreateOrg  = lazy(() => import('./pages/manage/CreateOrg'))
const NewFixture = lazy(() => import('./pages/fixtures/NewFixture'))
const MyPlayers  = lazy(() => import('./pages/MyPlayers'))

// Scorer
const ScoreList  = lazy(() => import('./pages/scorer/ScoreList'))
const ScoreMatch = lazy(() => import('./pages/scorer/ScoreMatch'))

// Admin pages (named exports resolved to a default for React.lazy)
import TeamGovernance from './pages/admin/TeamGovernance'
const AdminDashboard = lazy(() => import('./pages/admin/Dashboard'))
const OrganizationsList = lazy(() => import('./pages/admin/Organizations').then(m => ({ default: m.OrganizationsList })))
const NewOrganization   = lazy(() => import('./pages/admin/Organizations').then(m => ({ default: m.NewOrganization })))
const EditOrganization  = lazy(() => import('./pages/admin/Organizations').then(m => ({ default: m.EditOrganization })))
const PeopleList = lazy(() => import('./pages/admin/PeopleAdmin').then(m => ({ default: m.PeopleList })))
const NewPerson  = lazy(() => import('./pages/admin/PeopleAdmin').then(m => ({ default: m.NewPerson })))
const EditPerson = lazy(() => import('./pages/admin/PeopleAdmin').then(m => ({ default: m.EditPerson })))
const AdminCompetitionsList = lazy(() => import('./pages/admin/Competitions').then(m => ({ default: m.CompetitionsList })))
const AdminFixturesList = lazy(() => import('./pages/admin/Fixtures').then(m => ({ default: m.FixturesList })))
const ResultQueue = lazy(() => import('./pages/admin/ResultQueue'))
const Permissions = lazy(() => import('./pages/admin/Permissions'))
const UserAccess  = lazy(() => import('./pages/admin/UserAccess'))
const SeoSettings = lazy(() => import('./pages/admin/SeoSettings'))

// Support Centre — lazy so the article content ships as its own chunk.
const SupportIndex   = lazy(() => import('./pages/support/SupportIndex'))
const SupportArticle = lazy(() => import('./pages/support/SupportArticle'))

// Scorer pages

// The Competition Manager is the single admin interface for a competition —
// old admin competition detail/edit URLs land there instead.
function RedirectToCompetitionManager() {
  const { id } = useParams()
  return <Navigate to={`/manage/competitions/${id}`} replace />
}

// /match/:date/:slug is ONE namespace resolving to EITHER a match day (group) or
// a standalone match — the dispatcher asks which by looking up a group at that
// (date, slug), then renders the right page.
function MatchDayOrMatch() {
  const { date, slug } = useParams()
  const [kind, setKind] = useState('loading')
  useEffect(() => {
    let live = true
    setKind('loading')
    fetchMatchGroup(date, slug)
      .then(g => { if (live) setKind(g ? 'group' : 'match') })
      .catch(() => { if (live) setKind('match') })
    return () => { live = false }
  }, [date, slug])
  if (kind === 'loading') {
    return <div className="flex justify-center py-12"><div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>
  }
  return kind === 'group' ? <MatchGroupPage /> : <MatchDetail />
}

export default function App() {
  return (
    <AuthProvider>
      <SiteSettingsProvider />
      <Routes>
        {/* Public + authenticated pages that share the Layout shell */}
        <Route element={<Layout />}>
          <Route path="/"                               element={<Home />} />
          <Route path="/install"                        element={<InstallHelp />} />
          <Route path="/support"                        element={<LazyBoundary><SupportIndex /></LazyBoundary>} />
          <Route path="/support/:category/:slug"        element={<LazyBoundary><SupportArticle /></LazyBoundary>} />
          <Route path="/legal/:doc"                     element={<LegalPage />} />
          <Route path="/contact"                        element={<Contact />} />
          <Route path="/competitions"                   element={<CompetitionsListPage />} />
          <Route path="/schools"                        element={<OrgList type="school" />} />
          <Route path="/schools/:slug"                  element={<OrgDetail type="school" />} />
          <Route path="/clubs"                          element={<OrgList type="club" />} />
          <Route path="/clubs/:slug"                    element={<OrgDetail type="club" />} />
          <Route path="/associations"                   element={<OrgList type="association" />} />
          <Route path="/associations/:slug"             element={<OrgDetail type="association" />} />
          <Route path="/browse"                          element={<Browse />} />
          <Route path="/players"                        element={<PlayersList />} />
          <Route path="/players/:id"                    element={<PlayerPage />} />
          <Route path="/player/:slug"                   element={<PlayerProfile />} />
          {/* Competition-scoped match URL — dateless, singular "match" segment */}
          <Route path="/competitions/:season/:competitionSlug/match/:matchSlug" element={<MatchDetail />} />
          {/* Dated, singular "match": /match/{date}/{slug} is a standalone match OR
              a match day (group) — the dispatcher resolves which. /{child} is always
              a group child. /times is the match-day times grid (scorer/admin). */}
          <Route path="/match/:date/:slug"              element={<MatchDayOrMatch />} />
          <Route path="/match/:date/:slug/times"        element={
            <ProtectedRoute require="scorer">
              <MatchTimesGrid />
            </ProtectedRoute>
          } />
          <Route path="/match/:date/:slug/:child"       element={<MatchDetail />} />
          {/* Slug-based SEO routes */}
          <Route path="/competition/:series/:ageGroup/:season"              element={<CompetitionOverview />} />
          <Route path="/competition/:series/:ageGroup/:season/standings"    element={<CompetitionStandings />} />
          <Route path="/competition/:series/:ageGroup/:season/fixtures"     element={<CompetitionFixtures />} />
          <Route path="/competition/:series/:ageGroup/:season/pools"        element={<CompetitionPools />} />
          <Route path="/competition/:series/:ageGroup/:season/knockout"     element={<CompetitionKnockout />} />
          <Route path="/competition/:series/:ageGroup/:season/stats"        element={<CompetitionFestivalStats />} />
          <Route path="/team/:slug"                     element={<TeamDetail />} />
          {/* ID-based competition routes */}
          <Route path="/competitions/:id"               element={<CompetitionOverview />} />
          <Route path="/competitions/:id/standings"     element={<CompetitionStandings />} />
          <Route path="/competitions/:id/fixtures"      element={<CompetitionFixtures />} />
          <Route path="/competitions/:id/pools"         element={<CompetitionPools />} />
          <Route path="/competitions/:id/knockout"      element={<CompetitionKnockout />} />
          <Route path="/competitions/:id/stats"         element={<CompetitionFestivalStats />} />
          {/* Season+slug competition routes: /competitions/:season/:slug */}
          <Route path="/competitions/:season/:competitionSlug"              element={<CompetitionOverview />} />
          <Route path="/competitions/:season/:competitionSlug/standings"    element={<CompetitionStandings />} />
          <Route path="/competitions/:season/:competitionSlug/fixtures"     element={<CompetitionFixtures />} />
          <Route path="/competitions/:season/:competitionSlug/pools"        element={<CompetitionPools />} />
          <Route path="/competitions/:season/:competitionSlug/knockout"     element={<CompetitionKnockout />} />
          <Route path="/competitions/:season/:competitionSlug/stats"        element={<CompetitionFestivalStats />} />
          <Route path="/profile"                        element={
            <ProtectedRoute require="any">
              <Profile />
            </ProtectedRoute>
          } />
          <Route path="/my-players"                     element={
            <ProtectedRoute require="any">
              <MyPlayers />
            </ProtectedRoute>
          } />

          {/* Manage hub — any signed-in user (scorer gate also admits org members) */}
          <Route path="/manage" element={
            <ProtectedRoute require="any">
              <ManageHub />
            </ProtectedRoute>
          } />
          <Route path="/manage/new-org" element={
            <ProtectedRoute require="any">
              <CreateOrg />
            </ProtectedRoute>
          } />
          <Route path="/manage/orgs/:id" element={
            <ProtectedRoute require="any">
              <OrgManage />
            </ProtectedRoute>
          } />
          <Route path="/manage/competitions" element={
            <ProtectedRoute require="any">
              <CompetitionsManageList />
            </ProtectedRoute>
          } />
          <Route path="/manage/competitions/new" element={
            <ProtectedRoute require="any">
              <CreateCompetition />
            </ProtectedRoute>
          } />
          <Route path="/manage/competitions/:id" element={
            <ProtectedRoute require="any">
              <CompetitionManage />
            </ProtectedRoute>
          } />
          <Route path="/fixtures/new" element={
            <ProtectedRoute require="any">
              <NewFixture />
            </ProtectedRoute>
          } />
          <Route path="/match/new/group" element={
            <ProtectedRoute require="any">
              <CreateMatchGroup />
            </ProtectedRoute>
          } />

          {/* Scorer match list shares the main app shell so it keeps full
              navigation. The live scoring screen (/score/:id) stays standalone. */}
          <Route path="/score" element={
            <ProtectedRoute require="scorer">
              <ScoreList />
            </ProtectedRoute>
          } />

          {/* Nested team profile: /{org-slug}/{team-segment}. All-dynamic, so it
              ranks below every static two-segment route (e.g. /schools/:slug,
              /competitions/:id) and only catches genuine org/team paths. */}
          <Route path="/:orgSlug/:teamSlug"             element={<TeamDetail />} />

          <Route path="*"                               element={<NotFound />} />
        </Route>

        {/* Auth — sign-in/up happen locally on this origin against the shared
            Firebase project (platform brief v2 §2). Outside the guard. */}
        <Route path="/login"   element={<Login />} />
        <Route path="/signup"  element={<Signup />} />

        {/* Admin — requires platform admin */}
        <Route path="/admin" element={
          <ProtectedRoute require="admin">
            <AdminLayout />
          </ProtectedRoute>
        }>
          <Route index                              element={<AdminDashboard />} />
          <Route path="organizations"               element={<OrganizationsList />} />
          <Route path="organizations/new"           element={<NewOrganization />} />
          <Route path="organizations/:id"           element={<EditOrganization />} />
          <Route path="people"                      element={<PeopleList />} />
          <Route path="people/new"                  element={<NewPerson />} />
          <Route path="people/:id"                  element={<EditPerson />} />
          <Route path="permissions"                 element={<Permissions />} />
          <Route path="user-access"                 element={<UserAccess />} />
          <Route path="seo"                         element={<SeoSettings />} />
          <Route path="competitions"                element={<AdminCompetitionsList />} />
          <Route path="fixtures"                    element={<AdminFixturesList />} />
          <Route path="result-queue"                element={<ResultQueue />} />
          <Route path="team-governance"             element={<TeamGovernance />} />
          {/* Old admin detail/edit/create pages redirect to the manage flow. */}
          <Route path="competitions/new"            element={<Navigate to="/manage/competitions/new" replace />} />
          <Route path="competitions/:id"            element={<RedirectToCompetitionManager />} />
          <Route path="competitions/:id/edit"       element={<RedirectToCompetitionManager />} />
        </Route>

        {/* Scorer — platform admins and organisation owners/staff (Phase 1D).
            Match-level org ownership is enforced when a specific match loads.
            The live scoring screen is full-screen and standalone (own back nav);
            the /score list lives inside the main Layout shell above. */}
        <Route path="/score/:id" element={
          <ProtectedRoute require="scorer">
            <LazyBoundary><ScoreMatch /></LazyBoundary>
          </ProtectedRoute>
        } />
      </Routes>
    </AuthProvider>
  )
}
