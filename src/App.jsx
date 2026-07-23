import { lazy } from 'react'
import { Routes, Route, Navigate, useParams } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import LazyBoundary from './components/LazyBoundary'
import Layout from './components/Layout'
import AdminLayout from './components/AdminLayout'
import ProtectedRoute from './components/ProtectedRoute'
import SiteSettingsProvider from './components/SiteSettingsProvider'

// Public pages
import Home from './pages/Home'
import WhyMatchPulse from './pages/WhyMatchPulse'
import Plans from './pages/Plans'
import Signup from './pages/Signup'
import CompetitionsListPage from './pages/CompetitionsList'
import OrgList from './pages/OrgList'
import OrgDetail from './pages/OrgDetail'
import Browse from './pages/Browse'
import PlayersList from './pages/PlayersList'
import PlayerPage from './pages/PlayerPage'
import PlayerProfile from './pages/PlayerProfile'
import MatchDetail from './pages/MatchDetail'
import CompetitionOverview from './pages/CompetitionOverview'
import CompetitionStandings from './pages/CompetitionStandings'
import CompetitionFixtures from './pages/CompetitionFixtures'
import CompetitionPools from './pages/CompetitionPools'
import CompetitionKnockout from './pages/CompetitionKnockout'
import CompetitionFestivalStats from './pages/CompetitionFestivalStats'
import TeamDetail from './pages/TeamDetail'
import Login from './pages/Login'
import Portal from './pages/Portal'
import Profile from './pages/Profile'
import LegalPage from './pages/legal/LegalPage'
import Contact from './pages/Contact'
import NotFound from './pages/NotFound'

// Manage pages (org owners, staff, self-service)
import ManageHub  from './pages/manage/Hub'
import CompetitionManage from './pages/manage/competitions/CompetitionManage'
import CompetitionsManageList from './pages/manage/competitions/CompetitionsList'
import CreateCompetition from './pages/manage/competitions/CreateCompetition'
import OrgManage  from './pages/manage/OrgManage'
import CreateOrg  from './pages/manage/CreateOrg'
import NewFixture from './pages/fixtures/NewFixture'

// Admin pages
import AdminDashboard from './pages/admin/Dashboard'
import { OrganizationsList, NewOrganization, EditOrganization } from './pages/admin/Organizations'
import { PeopleList, NewPerson, EditPerson } from './pages/admin/PeopleAdmin'
import { CompetitionsList as AdminCompetitionsList } from './pages/admin/Competitions'
import { FixturesList as AdminFixturesList } from './pages/admin/Fixtures'
import ResultQueue from './pages/admin/ResultQueue'
import InstallHelp from './pages/InstallHelp'
import Permissions from './pages/admin/Permissions'
import UserAccess from './pages/admin/UserAccess'
import SeoSettings from './pages/admin/SeoSettings'

// Support Centre — lazy so the article content ships as its own chunk.
const SupportIndex   = lazy(() => import('./pages/support/SupportIndex'))
const SupportArticle = lazy(() => import('./pages/support/SupportArticle'))
import BillingSettings from './pages/admin/BillingSettings'
import MyPlayers from './pages/MyPlayers'

// Scorer pages
import ScoreList  from './pages/scorer/ScoreList'
import ScoreMatch from './pages/scorer/ScoreMatch'

// The Competition Manager is the single admin interface for a competition —
// old admin competition detail/edit URLs land there instead.
function RedirectToCompetitionManager() {
  const { id } = useParams()
  return <Navigate to={`/manage/competitions/${id}`} replace />
}

export default function App() {
  return (
    <AuthProvider>
      <SiteSettingsProvider />
      <Routes>
        {/* Public + authenticated pages that share the Layout shell */}
        <Route element={<Layout />}>
          <Route path="/"                               element={<Home />} />
          <Route path="/why-matchpulse"                 element={<WhyMatchPulse />} />
          <Route path="/install"                        element={<InstallHelp />} />
          <Route path="/plans"                          element={<Plans />} />
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
          {/* Competition-scoped match URLs */}
          <Route path="/competitions/:season/:competitionSlug/matches/:matchSlug" element={<MatchDetail />} />
          {/* Season-namespaced match URLs (Phase 1C+) */}
          <Route path="/matches/:season/:matchSlug"     element={<MatchDetail />} />
          <Route path="/matches/:id"                    element={<MatchDetail />} />
          {/* Slug-based SEO routes */}
          <Route path="/competition/:series/:ageGroup/:season"              element={<CompetitionOverview />} />
          <Route path="/competition/:series/:ageGroup/:season/standings"    element={<CompetitionStandings />} />
          <Route path="/competition/:series/:ageGroup/:season/fixtures"     element={<CompetitionFixtures />} />
          <Route path="/competition/:series/:ageGroup/:season/pools"        element={<CompetitionPools />} />
          <Route path="/competition/:series/:ageGroup/:season/knockout"     element={<CompetitionKnockout />} />
          <Route path="/competition/:series/:ageGroup/:season/stats"        element={<CompetitionFestivalStats />} />
          <Route path="/match/:slug"                    element={<MatchDetail />} />
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

        {/* Auth */}
        <Route path="/login"   element={<Login />} />
        <Route path="/signup"  element={<Signup />} />
        <Route path="/portal"  element={<Portal />} />

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
          <Route path="billing"                     element={<BillingSettings />} />
          <Route path="competitions"                element={<AdminCompetitionsList />} />
          <Route path="fixtures"                    element={<AdminFixturesList />} />
          <Route path="result-queue"                element={<ResultQueue />} />
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
            <ScoreMatch />
          </ProtectedRoute>
        } />
      </Routes>
    </AuthProvider>
  )
}
