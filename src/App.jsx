import { useState, useEffect } from 'react'
import './App.css'

// ── 요일 목록
const DAYS = ['월', '화', '수', '목', '금']

// ── 수동 선택 태그 (3종류만)
const MANUAL_TAGS = ['늦참', '야근 중', '쉴게용']

// ── 관리자 PIN (임시 — 나중에 Supabase 인증으로 교체)
const ADMIN_PIN = '1234'

// ── 날짜 문자열 → 요일 레이블 변환 헬퍼
function getDayLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const day = new Date(y, m - 1, d).getDay() // 0=일, 1=월 ... 6=토
  return DAYS[day - 1] ?? null
}

// ── 오늘 날짜 문자열 (YYYY-MM-DD)
function getTodayStr() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// ────────────────────────────────────────────
// localStorage 헬퍼 함수
// ────────────────────────────────────────────
function lsGet(key, fallback) {
  try {
    const val = localStorage.getItem(key)
    return val !== null ? JSON.parse(val) : fallback
  } catch {
    return fallback
  }
}
function lsSet(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
}

// ── 초 → HH:MM
function formatTime(seconds) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// ────────────────────────────────────────────
// 멤버 상태 우선순위 계산 함수
// 반환: { type, label }
//   type: 'attending' | 'tag' | 'scheduled' | 'rest'
// ────────────────────────────────────────────
function getMemberStatus({ name, attendees, memberTags, goals, todayDayLabel, getElapsed }) {
  // 1순위: 현재 출석 중
  if (attendees[name]) {
    return { type: 'attending', label: `참석 중 ${formatTime(getElapsed(name))}` }
  }
  // 2순위: 수동 태그
  if (memberTags[name]) {
    return { type: 'tag', label: memberTags[name] }
  }
  // 3순위: 오늘 참석 목표 있음
  if (todayDayLabel && goals[name]?.[todayDayLabel]) {
    return { type: 'scheduled', label: '참석 예정' }
  }
  // 4순위: 쉬는 날
  return { type: 'rest', label: '오늘은 쉬는날' }
}

// ────────────────────────────────────────────
// App 컴포넌트
// ────────────────────────────────────────────
function App() {
  // ── 현재 사용자 이름 (localStorage)
  const [myName, setMyName] = useState(() => lsGet('zs_myName', null))

  // ── 이름 입력 필드 (프로필 생성 화면용)
  const [nameInput, setNameInput] = useState('')
  const [nameError, setNameError] = useState('')

  // ── 관리자 PIN 인증
  const [adminUnlocked, setAdminUnlocked] = useState(false)
  const [pinInput, setPinInput] = useState('')
  const [pinError, setPinError] = useState('')

  // ── 테스트용 날짜 (기본값: 실제 오늘)
  const [testDate, setTestDate] = useState(getTodayStr)

  // ── 선택한 날짜 기준 요일 레이블 (평일이면 '월'~'금', 주말이면 null)
  const todayDayLabel = getDayLabel(testDate)

  // ── 현재 탭
  const [tab, setTab] = useState('dashboard')

  // ── 수동 태그: 멤버별 { '지민': '늦참', '수현': '' ... }
  // 내 태그만 수정 가능하지만 구조는 멤버 전체로 관리
  const [memberTags, setMemberTags] = useState(() => lsGet('zs_memberTags', {}))

  // ── 등록된 멤버 목록 (localStorage)
  const [members, setMembers] = useState(() => lsGet('zs_members', []))

  // ── 주간 목표 요일 (localStorage)
  const [goals, setGoals] = useState(() => lsGet('zs_goals', {}))

  // ── 주간 누적 시간 초 (localStorage)
  const [weeklySeconds, setWeeklySeconds] = useState(() => lsGet('zs_weeklySeconds', {}))

  // ── 현재 출석 중인 멤버 (세션 상태, 새로고침 시 초기화)
  const [attendees, setAttendees] = useState({})

  // ── 1초마다 화면 갱신 (실시간 타이머)
  const [, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  // ────────────────────────────────────────────
  // 파생 값
  // ────────────────────────────────────────────

  // 경과 시간 계산 (초)
  function getElapsed(name) {
    if (!attendees[name]) return 0
    return Math.floor((new Date() - attendees[name].startTime) / 1000)
  }

  // 오늘 참석 목표가 있는 전체 멤버
  const todayScheduled = todayDayLabel
    ? members.filter(m => goals[m]?.[todayDayLabel])
    : []

  // 현재 출석 중인 멤버 목록
  const currentAttendees = Object.keys(attendees)

  // 내가 출석 중인지 여부
  const isMeCheckedIn = !!attendees[myName]

  // 내가 오늘 참석 예정인지 여부 (주간 목표 기준)
  const isMeScheduledToday = !!(todayDayLabel && goals[myName]?.[todayDayLabel])

  // 내 현재 수동 태그
  const myTag = memberTags[myName] || ''

  // 내 현재 상태 (우선순위 계산)
  const myStatus = getMemberStatus({
    name: myName,
    attendees,
    memberTags,
    goals,
    todayDayLabel,
    getElapsed,
  })

  // ────────────────────────────────────────────
  // 핸들러
  // ────────────────────────────────────────────

  // 프로필 생성
  function handleCreateProfile() {
    const name = nameInput.trim()
    if (!name) { setNameError('이름을 입력해주세요'); return }
    if (name.length > 10) { setNameError('이름은 10자 이내로 입력해주세요'); return }

    const newMembers = members.includes(name) ? members : [...members, name]
    const newGoals = {
      ...goals,
      [name]: goals[name] || { 월: false, 화: false, 수: false, 목: false, 금: false },
    }
    const newWeekly = { ...weeklySeconds, [name]: weeklySeconds[name] || 0 }

    lsSet('zs_myName', name)
    lsSet('zs_members', newMembers)
    lsSet('zs_goals', newGoals)
    lsSet('zs_weeklySeconds', newWeekly)

    setMyName(name)
    setMembers(newMembers)
    setGoals(newGoals)
    setWeeklySeconds(newWeekly)
    setNameError('')
  }

  // 프로필 전환
  function handleLogout() {
    if (attendees[myName]) {
      const elapsed = Math.floor((new Date() - attendees[myName].startTime) / 1000)
      const newWeekly = { ...weeklySeconds, [myName]: (weeklySeconds[myName] || 0) + elapsed }
      lsSet('zs_weeklySeconds', newWeekly)
      setWeeklySeconds(newWeekly)
    }
    lsSet('zs_myName', null)
    setMyName(null)
    setNameInput('')
    setNameError('')
    setTab('dashboard')
    setAttendees({})
  }

  // 출석하기
  function handleCheckIn() {
    if (isMeCheckedIn) return
    setAttendees(prev => ({ ...prev, [myName]: { startTime: new Date() } }))
  }

  // 퇴장하기
  function handleCheckOut() {
    if (!isMeCheckedIn) return
    const elapsed = Math.floor((new Date() - attendees[myName].startTime) / 1000)
    const newWeekly = { ...weeklySeconds, [myName]: (weeklySeconds[myName] || 0) + elapsed }
    lsSet('zs_weeklySeconds', newWeekly)
    setWeeklySeconds(newWeekly)
    setAttendees(prev => { const next = { ...prev }; delete next[myName]; return next })
  }

  // 수동 태그 선택 (같은 태그 누르면 해제)
  function handleTagToggle(tag) {
    const newTag = myTag === tag ? '' : tag
    const newTags = { ...memberTags, [myName]: newTag }
    lsSet('zs_memberTags', newTags)
    setMemberTags(newTags)
  }

  // 태그 초기화
  function handleTagClear() {
    const newTags = { ...memberTags, [myName]: '' }
    lsSet('zs_memberTags', newTags)
    setMemberTags(newTags)
  }

  // 주간 목표 토글
  function toggleGoal(member, day) {
    const newGoals = { ...goals, [member]: { ...goals[member], [day]: !goals[member]?.[day] } }
    lsSet('zs_goals', newGoals)
    setGoals(newGoals)
  }

  // ── 관리자 PIN 확인
  function handlePinSubmit() {
    if (pinInput === ADMIN_PIN) {
      setAdminUnlocked(true)
      setPinError('')
      setPinInput('')
    } else {
      setPinError('올바르지 않은 PIN입니다')
    }
  }

  // ── 멤버 삭제 (Supabase 전환 시 handleDeleteMember(memberId) 형태 유지)
  function handleDeleteMember(memberName) {
    const confirmed = window.confirm(`"전${memberName}"을(를) 삭제하시겠습니까?\n\n해당 멤버의 주간 목표, 누적 시간, 태그 데이터가 모두 삭제됩니다.`)
    if (!confirmed) return

    // 1. 멤버 목록에서 제거
    const newMembers = members.filter(m => m !== memberName)
    lsSet('zs_members', newMembers)
    setMembers(newMembers)

    // 2. 주간 목표 삭제
    const newGoals = { ...goals }
    delete newGoals[memberName]
    lsSet('zs_goals', newGoals)
    setGoals(newGoals)

    // 3. 주간 누적 시간 삭제
    const newWeekly = { ...weeklySeconds }
    delete newWeekly[memberName]
    lsSet('zs_weeklySeconds', newWeekly)
    setWeeklySeconds(newWeekly)

    // 4. 상태 태그 삭제
    const newTags = { ...memberTags }
    delete newTags[memberName]
    lsSet('zs_memberTags', newTags)
    setMemberTags(newTags)

    // 5. 삭제된 멤버가 현재 로그인 상태이면 로그아웃
    if (myName === memberName) {
      lsSet('zs_myName', null)
      setMyName(null)
      setNameInput('')
    }

    // 6. 출석 중이었으면 출석 제거
    setAttendees(prev => {
      const next = { ...prev }
      delete next[memberName]
      return next
    })
  }

  // ════════════════════════════════════════
  // 📌 프로필 생성 화면
  // ════════════════════════════════════════
  if (!myName) {
    return (
      <div className="app-wrapper">
        <div className="profile-screen">
          <div className="profile-card">
            <div className="profile-icon">📹</div>
            <h1 className="profile-title">각자 할거 하는 모임 🌿</h1>
            <p className="profile-subtitle">이름을 입력하고 스터디를 시작하세요</p>
            <div className="profile-form">
              <input
                id="name-input"
                type="text"
                className={`name-input ${nameError ? 'input-error' : ''}`}
                placeholder="이름 입력 (예: 지민)"
                value={nameInput}
                onChange={e => { setNameInput(e.target.value); setNameError('') }}
                onKeyDown={e => e.key === 'Enter' && handleCreateProfile()}
                maxLength={10}
                autoFocus
              />
              {nameError && <p className="error-msg">{nameError}</p>}
              <button id="btn-create-profile" className="btn btn-primary-full" onClick={handleCreateProfile}>
                프로필 생성 →
              </button>
            </div>
            {members.length > 0 && (
              <div className="existing-members">
                <p className="existing-label">이미 등록된 멤버</p>
                <div className="member-chips">
                  {members.map(name => (
                    <button key={name} className="chip chip-clickable"
                      onClick={() => { setNameInput(name); setNameError('') }}>
                      {name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ════════════════════════════════════════
  // 📌 메인 앱 화면
  // ════════════════════════════════════════
  return (
    <div className="app-wrapper">
      {/* ── 테스트 날짜 컨트롤 바 */}
      <div className="test-bar">
        <span className="test-bar-label">🛠 테스트 날짜</span>
        <input
          id="test-date-input"
          type="date"
          className="test-date-input"
          value={testDate}
          onChange={e => setTestDate(e.target.value)}
        />
        <span className="test-bar-day">
          {todayDayLabel ? `${todayDayLabel}요일` : '주말'}
        </span>
        <button className="test-bar-reset" onClick={() => setTestDate(getTodayStr())}>
          오늘로 초기화
        </button>
      </div>

      {/* ── 헤더 */}
      <header className="app-header">
        <div className="header-inner">
          <div className="header-logo">
            <span className="logo-icon">📹</span>
            <h1 className="logo-text">각자 할거 하는 모임</h1>
          </div>
          <div className="header-right">
            <span className="header-user">👤 {myName}</span>
            <span className="header-date">
              {new Date().toLocaleDateString('ko-KR', { weekday: 'short', month: 'long', day: 'numeric' })}
            </span>
            <button className="btn-logout" onClick={handleLogout}>전환</button>
          </div>
        </div>
      </header>

      {/* ── 탭 네비게이션 */}
      <nav className="tab-nav">
        <button className={`tab-btn ${tab === 'dashboard' ? 'active' : ''}`} onClick={() => setTab('dashboard')}>
          🏠 대시보드
        </button>
        <button className={`tab-btn ${tab === 'goals' ? 'active' : ''}`} onClick={() => setTab('goals')}>
          🎯 주간 목표
        </button>
        <button className={`tab-btn ${tab === 'stats' ? 'active' : ''}`} onClick={() => setTab('stats')}>
          📊 주간 통계
        </button>
        <button className={`tab-btn tab-btn-admin ${tab === 'admin' ? 'active-admin' : ''}`} onClick={() => setTab('admin')}>
          ⚙️ 관리
        </button>
      </nav>

      <main className="main-content">

        {/* ══ 탭 1: 대시보드 ══ */}
        {tab === 'dashboard' && (
          <div className="dashboard">

            {/* ── 내 스터디 참여 카드 */}
            <section className="card my-info-card">
              <h2 className="card-title">
                📚 내 스터디 참여 — <span className="my-name-highlight">{myName}</span>
              </h2>

              {/* 내 현재 상태 뱃지 */}
              <div className={`my-status-banner status-${myStatus.type}`}>
                {myStatus.type === 'attending' && <span className="status-dot pulse" />}
                <span className="status-banner-text">{myStatus.label}</span>
              </div>

              {/* 출석 / 퇴장 버튼 (가장 눈에 띄게) */}
              <div className="btn-row">
                <button
                  id="btn-checkin"
                  className={`btn btn-checkin ${isMeCheckedIn ? 'disabled' : ''}`}
                  onClick={handleCheckIn}
                  disabled={isMeCheckedIn}
                >
                  ✅ 출석하기
                </button>
                <button
                  id="btn-checkout"
                  className={`btn btn-checkout ${!isMeCheckedIn ? 'disabled' : ''}`}
                  onClick={handleCheckOut}
                  disabled={!isMeCheckedIn}
                >
                  🚪 퇴장하기
                </button>
              </div>

              {/* ── 오늘 상태 태그 선택 영역 */}
              <div className="tag-section">
                <div className="tag-section-header">
                  <span className="tag-section-title">오늘 상태 태그</span>
                  {myTag && (
                    <button className="tag-clear-btn" onClick={handleTagClear}>
                      ✕ 태그 해제
                    </button>
                  )}
                </div>

                {!isMeScheduledToday && !todayDayLabel ? (
                  // 주말
                  <p className="tag-disabled-msg">오늘은 주말입니다 😊</p>
                ) : !isMeScheduledToday ? (
                  // 평일이지만 참석 예정 아님
                  <p className="tag-disabled-msg">
                    오늘은 쉬는날입니다 — 주간 목표에서 요일을 추가하면 태그를 사용할 수 있어요
                  </p>
                ) : (
                  // 오늘 참석 예정인 멤버만 태그 선택 가능
                  <div className="tag-btn-row">
                    {MANUAL_TAGS.map(tag => (
                      <button
                        key={tag}
                        className={`tag-btn ${myTag === tag ? 'tag-active' : ''}`}
                        onClick={() => handleTagToggle(tag)}
                      >
                        {tag === '늦참' && '⏰ '}
                        {tag === '야근 중' && '💼 '}
                        {tag === '쉴게용' && '😴 '}
                        {tag}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* ── 오늘 멤버 현황 카드 */}
            <section className="card">
              <h2 className="card-title">
                📅 오늘 멤버 현황
                <span className="day-badge">{todayDayLabel ? `${todayDayLabel}요일` : '주말'}</span>
              </h2>

              {!todayDayLabel ? (
                <p className="empty-msg">오늘은 주말입니다 😊</p>
              ) : members.length === 0 ? (
                <p className="empty-msg">등록된 멤버가 없습니다</p>
              ) : (
                <div className="member-status-list">
                  {members.map(name => {
                    const st = getMemberStatus({ name, attendees, memberTags, goals, todayDayLabel, getElapsed })
                    return (
                      <div key={name} className={`member-status-row status-row-${st.type}`}>
                        <div className="member-status-left">
                          {st.type === 'attending' && <span className="attendee-dot pulse" />}
                          <span className="member-status-name">
                            {name}
                            {name === myName && <span className="me-tag">나</span>}
                          </span>
                        </div>
                        <span className={`member-status-badge badge-${st.type}`}>
                          {st.type === 'attending' && '🟢 '}
                          {st.type === 'tag' && '🏷 '}
                          {st.type === 'scheduled' && '🕐 '}
                          {st.type === 'rest' && '💤 '}
                          {st.label}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>

            {/* ── 현재 출석 중 카드 (출석자가 있을 때만 표시) */}
            {currentAttendees.length > 0 && (
              <section className="card">
                <h2 className="card-title">
                  🟢 현재 출석 중
                  <span className="count-badge">{currentAttendees.length}명</span>
                </h2>
                <div className="attendee-list">
                  {currentAttendees.map(name => (
                    <div key={name} className="attendee-item">
                      <div className="attendee-left">
                        <span className="attendee-dot pulse" />
                        <span className="attendee-name">{name}</span>
                        {memberTags[name] && (
                          <span className="status-tag">{memberTags[name]}</span>
                        )}
                      </div>
                      <span className="attendee-time">{formatTime(getElapsed(name))}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {/* ══ 탭 2: 주간 목표 ══ */}
        {tab === 'goals' && (
          <div className="goals-page">
            <section className="card">
              <h2 className="card-title">🎯 멤버별 주간 참석 예정 요일</h2>
              <p className="card-desc">체크박스를 클릭해 언제든지 수정할 수 있습니다</p>
              {members.length === 0 ? (
                <p className="empty-msg">등록된 멤버가 없습니다</p>
              ) : (
                <div className="goals-table-wrapper">
                  <table className="goals-table">
                    <thead>
                      <tr>
                        <th className="th-name">멤버</th>
                        {DAYS.map(day => (
                          <th key={day} className={`th-day ${todayDayLabel === day ? 'today-col' : ''}`}>
                            {day}
                            {todayDayLabel === day && <span className="today-dot">●</span>}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {members.map(member => (
                        <tr key={member} className={`goal-row ${member === myName ? 'my-row' : ''}`}>
                          <td className="td-name">
                            {member === myName && <span className="me-tag">나</span>}
                            {member}
                          </td>
                          {DAYS.map(day => (
                            <td key={day} className={`td-check ${todayDayLabel === day ? 'today-col' : ''}`}>
                              <input
                                type="checkbox"
                                id={`goal-${member}-${day}`}
                                className="goal-checkbox"
                                checked={!!goals[member]?.[day]}
                                onChange={() => toggleGoal(member, day)}
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}

        {/* ══ 탭 3: 주간 통계 ══ */}
        {tab === 'stats' && (
          <div className="stats-page">
            <section className="card">
              <h2 className="card-title">📊 주간 누적 참석 시간</h2>
              <p className="card-desc">목표: 주간 10시간 달성</p>

              {members.length === 0 ? (
                <p className="empty-msg">등록된 멤버가 없습니다</p>
              ) : (
                <div className="stats-list">
                  {members
                    .slice()
                    .sort((a, b) => {
                      const aT = (weeklySeconds[a] || 0) + getElapsed(a)
                      const bT = (weeklySeconds[b] || 0) + getElapsed(b)
                      return bT - aT
                    })
                    .map((name, idx) => {
                      const total = (weeklySeconds[name] || 0) + getElapsed(name)
                      const goal = 36000
                      const pct = Math.min((total / goal) * 100, 100)
                      const achieved = total >= goal
                      return (
                        <div key={name} className={`stat-item ${achieved ? 'achieved' : 'not-achieved'}`}>
                          <div className="stat-rank">#{idx + 1}</div>
                          <div className="stat-info">
                            <div className="stat-name-row">
                              <span className="stat-name">
                                {name}
                                {name === myName && <span className="me-tag">나</span>}
                              </span>
                              <span className={`stat-time ${achieved ? 'time-done' : 'time-lack'}`}>
                                {formatTime(total)}
                              </span>
                              {achieved
                                ? <span className="badge-achieved">🏆 달성!</span>
                                : <span className="badge-lacking">⏳ {formatTime(goal - total)} 부족</span>
                              }
                            </div>
                            <div className="progress-bar-bg">
                              <div
                                className={`progress-bar-fill ${achieved ? 'fill-done' : 'fill-progress'}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      )
                    })}
                </div>
              )}

              <div className="lacking-summary">
                <h3 className="lacking-title">⚠️ 10시간 미달성 멤버</h3>
                <div className="member-chips">
                  {members.filter(n => (weeklySeconds[n] || 0) + getElapsed(n) < 36000).length === 0
                    ? <span className="chip chip-present">🎉 전원 달성!</span>
                    : members
                        .filter(n => (weeklySeconds[n] || 0) + getElapsed(n) < 36000)
                        .map(n => <span key={n} className="chip chip-lacking">{n}</span>)
                  }
                </div>
              </div>
            </section>
          </div>
        )}
        {/* ══ 탭 4: 멤버 관리 ══ */}
        {tab === 'admin' && (
          <div className="admin-page">
            <section className="card">
              <h2 className="card-title">⚙️ 멤버 관리</h2>
              <p className="card-desc">등록된 멤버를 확인하고 삭제할 수 있어요</p>

              {/* PIN 미인증 상태 */}
              {!adminUnlocked ? (
                <div className="pin-section">
                  <div className="pin-icon">🔐</div>
                  <p className="pin-desc">관리자 PIN을 입력해주세요</p>
                  <div className="pin-input-row">
                    <input
                      id="pin-input"
                      type="password"
                      className={`pin-input ${pinError ? 'input-error' : ''}`}
                      placeholder="PIN 입력"
                      value={pinInput}
                      onChange={e => { setPinInput(e.target.value); setPinError('') }}
                      onKeyDown={e => e.key === 'Enter' && handlePinSubmit()}
                      maxLength={8}
                      autoComplete="off"
                    />
                    <button id="btn-pin-submit" className="btn-pin-submit" onClick={handlePinSubmit}>
                      확인
                    </button>
                  </div>
                  {pinError && <p className="error-msg" style={{ textAlign: 'center', marginTop: '8px' }}>{pinError}</p>}
                </div>
              ) : (
                /* PIN 인증 성공 상태 */
                <div className="admin-content">
                  <div className="admin-unlocked-bar">
                    <span className="admin-unlocked-label">🔓 관리자 모드</span>
                    <button
                      className="btn-admin-lock"
                      onClick={() => { setAdminUnlocked(false); setPinInput('') }}
                    >
                      잠금
                    </button>
                  </div>

                  {members.length === 0 ? (
                    <p className="empty-msg">등록된 멤버가 없습니다</p>
                  ) : (
                    <div className="admin-member-list">
                      {members.map(name => (
                        <div key={name} className="admin-member-row">
                          <div className="admin-member-info">
                            <span className="admin-member-name">
                              {name === myName && <span className="me-tag">나</span>}
                              {name}
                            </span>
                            <span className="admin-member-stats">
                              누적 {formatTime((weeklySeconds[name] || 0) + getElapsed(name))}
                              {goals[name] && (
                                <span className="admin-goal-days">
                                  {DAYS.filter(d => goals[name]?.[d]).join('·') || '목표 없음'}
                                </span>
                              )}
                            </span>
                          </div>
                          <button
                            id={`btn-delete-${name}`}
                            className="btn-delete-member"
                            onClick={() => handleDeleteMember(name)}
                          >
                            삭제
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  )
}

export default App
