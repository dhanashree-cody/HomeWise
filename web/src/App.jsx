import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import { SafetyBar, ThemeToggle } from './components/ui.jsx';
import { Icon } from './components/icons.jsx';

import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Patients from './pages/Patients.jsx';
import PatientDetail from './pages/PatientDetail.jsx';
import NewAssessment from './pages/NewAssessment.jsx';
import Assessments from './pages/Assessments.jsx';
import AssessmentDetail from './pages/AssessmentDetail.jsx';
import Inventory from './pages/Inventory.jsx';
import Requests from './pages/Requests.jsx';
import RequestDetail from './pages/RequestDetail.jsx';
import Donors from './pages/Donors.jsx';
import DonorDetail from './pages/DonorDetail.jsx';
import Camps from './pages/Camps.jsx';
import RuleSets from './pages/RuleSets.jsx';
import AuditLog from './pages/AuditLog.jsx';
import Trace from './pages/Trace.jsx';
import Safety from './pages/Safety.jsx';

const NAV = [
  {
    label: 'Clinical',
    items: [
      { to: '/', icon: Icon.dashboard, text: 'Dashboard', end: true },
      { to: '/assess', icon: Icon.plus, text: 'New assessment', roles: ['clinician'] },
      { to: '/assessments', icon: Icon.list, text: 'Assessments' },
      { to: '/patients', icon: Icon.user, text: 'Patients' },
    ],
  },
  {
    label: 'Blood bank',
    items: [
      { to: '/requests', icon: Icon.request, text: 'Requests' },
      { to: '/inventory', icon: Icon.box, text: 'Inventory' },
      { to: '/donors', icon: Icon.drop, text: 'Donors' },
      { to: '/camps', icon: Icon.calendar, text: 'Camps' },
      { to: '/trace', icon: Icon.route, text: 'Trace a unit' },
    ],
  },
  {
    label: 'Governance',
    items: [
      { to: '/rules', icon: Icon.sliders, text: 'Rule sets' },
      { to: '/audit', icon: Icon.shield, text: 'Audit ledger' },
      { to: '/safety', icon: Icon.alert, text: 'Safety notice' },
    ],
  },
];

const TITLES = {
  '/': ['Dashboard', 'Stock, demand and open clinical activity at a glance'],
  '/assess': ['New assessment', 'Structured review with transparent flags and live stock coupling'],
  '/assessments': ['Assessments', 'Every review recorded, with the rule version that produced it'],
  '/patients': ['Patients', 'Synthetic patient register'],
  '/requests': ['Blood requests', 'From clinical request through crossmatch attestation to issue'],
  '/inventory': ['Inventory', 'Unit-level stock, expiry and demand projection'],
  '/donors': ['Donors', 'Donor register, eligibility screening and donation recording'],
  '/camps': ['Donation camps', 'Scheduling and collection priority by group'],
  '/trace': ['Trace a unit', 'Follow one unit from donor to patient'],
  '/rules': ['Rule sets', 'Versioned clinical review rules, diff and impact replay'],
  '/audit': ['Audit ledger', 'Hash-chained, append-only record of every action'],
  '/safety': ['Safety notice', 'What this prototype does and does not do'],
};

function Shell({ children }) {
  const { user, logout, can } = useAuth();
  const { pathname } = useLocation();
  const [title, sub] = TITLES[pathname] || (
    pathname.startsWith('/patients/') ? ['Patient record', 'Assessments, requests and transfusion history'] :
    pathname.startsWith('/assessments/') ? ['Assessment detail', 'Flags, evidence and fulfilment readiness'] :
    pathname.startsWith('/requests/') ? ['Request detail', 'Review, reserve and issue'] :
    pathname.startsWith('/donors/') ? ['Donor record', 'Eligibility, donations and units produced'] :
    ['HemoWise', '']
  );

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">H</div>
          <div>
            <div className="brand-name">HemoWise</div>
            <div className="brand-sub">Prototype &middot; synthetic data</div>
          </div>
        </div>
        <nav className="nav">
          {NAV.map((group) => {
            const items = group.items.filter((i) => !i.roles || can(...i.roles));
            if (!items.length) return null;
            return (
              <div className="nav-group" key={group.label}>
                <div className="nav-label">{group.label}</div>
                {items.map((i) => (
                  <NavLink key={i.to} to={i.to} end={i.end}>
                    <span className="ico">{i.icon({ width: 14, height: 14 })}</span>
                    {i.text}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <div className="small" style={{ fontWeight: 600 }}>{user?.fullName}</div>
          <div className="tiny muted" style={{ textTransform: 'capitalize', marginBottom: 8 }}>{user?.role}</div>
          <div className="btn-row">
            <button className="sm" onClick={logout}>
              {Icon.logout({ width: 13, height: 13 })} Sign out
            </button>
            <ThemeToggle />
          </div>
        </div>
      </aside>

      <div className="main">
        <SafetyBar />
        <header className="topbar">
          <div>
            <h1>{title}</h1>
            {sub && <div className="sub">{sub}</div>}
          </div>
        </header>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}

function Protected({ children }) {
  const { user, ready } = useAuth();
  if (!ready) return <div className="empty" style={{ paddingTop: 80 }}>Starting HemoWise...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Shell>{children}</Shell>;
}

export default function App() {
  const { user, ready } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={ready && user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/" element={<Protected><Dashboard /></Protected>} />
      <Route path="/assess" element={<Protected><NewAssessment /></Protected>} />
      <Route path="/assessments" element={<Protected><Assessments /></Protected>} />
      <Route path="/assessments/:id" element={<Protected><AssessmentDetail /></Protected>} />
      <Route path="/patients" element={<Protected><Patients /></Protected>} />
      <Route path="/patients/:id" element={<Protected><PatientDetail /></Protected>} />
      <Route path="/requests" element={<Protected><Requests /></Protected>} />
      <Route path="/requests/:id" element={<Protected><RequestDetail /></Protected>} />
      <Route path="/inventory" element={<Protected><Inventory /></Protected>} />
      <Route path="/donors" element={<Protected><Donors /></Protected>} />
      <Route path="/donors/:id" element={<Protected><DonorDetail /></Protected>} />
      <Route path="/camps" element={<Protected><Camps /></Protected>} />
      <Route path="/trace" element={<Protected><Trace /></Protected>} />
      <Route path="/rules" element={<Protected><RuleSets /></Protected>} />
      <Route path="/audit" element={<Protected><AuditLog /></Protected>} />
      <Route path="/safety" element={<Protected><Safety /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
