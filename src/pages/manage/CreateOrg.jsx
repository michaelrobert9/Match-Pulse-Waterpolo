import { useState } from 'react'
import { ChevronLeft, Palette} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { selfCreateOrganization } from '../../lib/adminQueries'
import { SCHOOL_GENDER_PROFILES } from '../../lib/teamNaming'
import { monogram } from '../../lib/names'

const TYPE_OPTIONS = [
  {
    value: 'school',
    label: 'School',
    description: 'A school hockey programme, representing one institution.',
  },
  {
    value: 'club',
    label: 'Club',
    description: 'A club that fields multiple teams across divisions.',
  },
  {
    value: 'association',
    label: 'Association',
    description: 'A regional or provincial body that organises competitions.',
  },
]

const COLOR_PRESETS = [
  '#006B3C', '#003087', '#CC0000', '#FF6B00',
  '#6B0099', '#007A7A', '#8B1A1A', '#1A3A6B',
]

function Input({ label, ...props }) {
  return (
    <div>
      <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1.5">{label}</label>
      <input
        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors"
        {...props}
      />
    </div>
  )
}

export default function CreateOrg() {
  const { refreshUserData } = useAuth()
  const navigate = useNavigate()

  const [type,         setType]         = useState('')
  const [name,         setName]         = useState('')
  const [primaryColor, setPrimaryColor] = useState('#006B3C')
  const [genderProfile, setGenderProfile] = useState('coed')
  const [description,  setDescription]  = useState('')
  const [website,      setWebsite]      = useState('')
  const [logoUrl,      setLogoUrl]      = useState('')
  const [saving,       setSaving]       = useState(false)
  const [error,        setError]        = useState('')

  const canSubmit = type && name.trim() && !saving

  const typeLabel = type === 'school' ? 'School' : type === 'club' ? 'Club' : type === 'association' ? 'Association' : 'Organisation'
  const namePlaceholder = type === 'school' ? 'e.g. Pretoria Girls High School' : type === 'club' ? 'e.g. Crusaders Hockey Club' : type === 'association' ? 'e.g. KZN Hockey Association' : 'e.g. Pretoria Girls High School'

  async function handleSubmit(e) {
    e.preventDefault()
    if (!canSubmit) return
    setSaving(true)
    setError('')
    try {
      const ref = await selfCreateOrganization({
        type,
        name:          name.trim(),
        primaryColor,
        description:   description.trim() || null,
        website:       website.trim() || null,
        logoUrl:       logoUrl.trim() || null,
        secondaryColor: '#FFFFFF',
        ...(type === 'school' ? { genderProfile } : {}),
      })
      await refreshUserData()
      navigate(`/manage/orgs/${ref.id}`, { replace: true, state: { freshOwner: true } })
    } catch (err) {
      setError(err.message ?? 'Something went wrong. Please try again.')
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-canvas">
      <div className="max-w-lg mx-auto px-4 py-8">

        {/* Header */}
        <div className="mb-8">
          <button onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-slate-500 hover:text-slate-900 transition-colors text-sm mb-6">
            <ChevronLeft className="w-4 h-4" />
            Back
          </button>
          <h1 className="font-display font-black text-slate-900 text-2xl leading-tight">
            Create your {typeLabel.toLowerCase()}
          </h1>
          <p className="text-slate-500 text-sm mt-2 leading-relaxed">
            You will become the owner and can immediately create teams, fixtures and score matches.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">

          {/* Type selector */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3">Type</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {TYPE_OPTIONS.map(opt => (
                <button type="button" key={opt.value} onClick={() => setType(opt.value)}
                  className={`p-4 rounded-xl border text-left transition-colors ${
                    type === opt.value
                      ? 'border-emerald-500 bg-emerald-50'
                      : 'border-slate-200 hover:border-slate-300 bg-white'
                  }`}>
                  <div className={`text-sm font-bold mb-1 ${type === opt.value ? 'text-emerald-700' : 'text-slate-700'}`}>
                    {opt.label}
                  </div>
                  <div className="text-[11px] text-slate-500 leading-snug">{opt.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Name */}
          <Input
            label={`${typeLabel} name`}
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={namePlaceholder}
            required
          />

          {/* School gender profile */}
          {type === 'school' && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">School gender profile</p>
              <div className="grid grid-cols-3 gap-2">
                {SCHOOL_GENDER_PROFILES.map(opt => (
                  <button type="button" key={opt.value} onClick={() => setGenderProfile(opt.value)}
                    className={`text-[11px] font-bold px-2 py-2.5 rounded-lg border transition-colors ${
                      genderProfile === opt.value
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}>
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-400 mt-1.5">
                Co-ed schools pick Boys or Girls for each team. Single-gender schools apply it automatically.
              </p>
            </div>
          )}

          {/* Colour */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">Primary colour</p>
            <div className="flex items-center gap-3 flex-wrap">
              {COLOR_PRESETS.map(c => (
                <button type="button" key={c} onClick={() => setPrimaryColor(c)}
                  className="w-8 h-8 rounded-lg transition-transform hover:scale-110 shrink-0"
                  style={{
                    backgroundColor: c,
                    outline: primaryColor === c ? `2px solid #1e293b` : 'none',
                    outlineOffset: '2px',
                  }}
                />
              ))}
              <label className="w-8 h-8 rounded-lg overflow-hidden cursor-pointer border border-slate-300 shrink-0"
                style={{ backgroundColor: COLOR_PRESETS.includes(primaryColor) ? 'transparent' : primaryColor }}>
                <input type="color" value={primaryColor} onChange={e => setPrimaryColor(e.target.value)}
                  className="opacity-0 w-0 h-0" />
                <div className="w-full h-full flex items-center justify-center text-slate-500">
                  {COLOR_PRESETS.includes(primaryColor) ? (
                    <Palette className="w-4 h-4" />
                  ) : null}
                </div>
              </label>
            </div>
            <div className="flex items-center gap-2 mt-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold font-mono"
                style={{ backgroundColor: primaryColor + '30', border: `2px solid ${primaryColor}`, color: primaryColor }}>
                {name ? monogram(name) : 'ORG'}
              </div>
              <span className="text-sm text-slate-700">{name || `${typeLabel} name`}</span>
            </div>
          </div>

          {/* Optional fields */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">
              Description <span className="text-slate-400 normal-case tracking-normal">optional</span>
            </p>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
              placeholder={`Brief description of your ${typeLabel.toLowerCase()}…`}
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors resize-none" />
          </div>

          <Input
            label={<>Website <span className="text-slate-400 normal-case tracking-normal font-normal">optional</span></>}
            value={website}
            onChange={e => setWebsite(e.target.value)}
            placeholder="https://…"
            type="url"
          />

          {/* Profile photo URL */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-1.5">
              Profile photo URL <span className="text-slate-400 normal-case tracking-normal font-normal">optional</span>
            </label>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 overflow-hidden"
                style={{ backgroundColor: primaryColor + '30', border: `2px solid ${primaryColor}` }}>
                {logoUrl.trim()
                  ? <img src={logoUrl.trim()} alt="" className="w-full h-full object-cover"
                      onError={e => { e.currentTarget.style.display = 'none' }}
                      onLoad={e => { e.currentTarget.style.display = '' }} />
                  : <span className="text-[10px] font-bold font-mono" style={{ color: primaryColor }}>{name ? monogram(name) : 'ORG'}</span>
                }
              </div>
              <input value={logoUrl} onChange={e => setLogoUrl(e.target.value)}
                type="url" placeholder="https://…"
                className="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors" />
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Link to a logo or crest image. You can change this later in settings.</p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600">{error}</div>
          )}

          <button type="submit" disabled={!canSubmit}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm uppercase tracking-wider rounded-xl py-4 transition-colors">
            {saving ? 'Creating…' : `Create ${typeLabel.toLowerCase()}`}
          </button>

          <p className="text-[11px] text-slate-400 text-center">
            You will be the owner and can manage teams, fixtures and staff.
          </p>
        </form>
      </div>
    </div>
  )
}
