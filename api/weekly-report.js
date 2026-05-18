// api/weekly-report.js
// Vercel Serverless Function — 주간 스터디 출석 리포트
//
// ⚠️  이 파일은 서버에서만 실행됩니다.
//     SUPABASE_SERVICE_ROLE_KEY는 절대 프론트엔드에 노출되지 않습니다.
//
// 엔드포인트: GET /api/weekly-report
// 응답:       { message: "..." }

import { createClient } from '@supabase/supabase-js'

// ── 상수
const GOAL_SECONDS = 18000 // 5시간 = 300분 = 18,000초

// ── KST(UTC+9) 기준 이번 주 월요일 ~ 일요일 날짜 계산
// attendance_sessions.date 컬럼은 'YYYY-MM-DD' 문자열이므로 날짜 범위만 사용
function getKSTWeekRange() {
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000
  const nowKST = new Date(Date.now() + KST_OFFSET_MS)

  // UTC 기준으로 KST 날짜를 읽음
  const day = nowKST.getUTCDay() // 0=일, 1=월 ... 6=토

  // 이번 주 월요일까지의 날짜 차이 (일요일이면 -6, 나머지는 1-day)
  const diffToMonday = day === 0 ? -6 : 1 - day

  const monday = new Date(nowKST)
  monday.setUTCDate(nowKST.getUTCDate() + diffToMonday)

  const sunday = new Date(monday)
  sunday.setUTCDate(monday.getUTCDate() + 6)

  function toDateStr(d) {
    const y = d.getUTCFullYear()
    const m = String(d.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(d.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${dd}`
  }

  return {
    weekStart: toDateStr(monday),
    weekEnd:   toDateStr(sunday),
  }
}

// ── 초 → "N시간 N분" 형식으로 변환
// 예: 19800 → "5시간 30분",  17940 → "4시간 59분",  3600 → "1시간",  900 → "15분"
function formatSeconds(totalSeconds) {
  const hours   = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)

  if (hours === 0)   return `${minutes}분`
  if (minutes === 0) return `${hours}시간`
  return `${hours}시간 ${minutes}분`
}

// ── YYYY-MM-DD → YYYY.MM.DD
function toKRDateStr(dateStr) {
  return dateStr.replace(/-/g, '.')
}

// ── Vercel Serverless Function 핸들러
export default async function handler(req, res) {
  // CORS 헤더 (Claude/PlayMCP 등 외부 클라이언트에서 호출 가능하게)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  // ── 환경변수 확인
  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[weekly-report] 환경변수 누락:', { supabaseUrl: !!supabaseUrl, serviceRoleKey: !!serviceRoleKey })
    return res.status(500).json({
      error: 'Supabase 환경변수가 설정되지 않았습니다. Vercel 대시보드에서 확인해주세요.',
    })
  }

  // ── Supabase 클라이언트 (service_role — RLS 우회, 서버 전용)
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  try {
    const { weekStart, weekEnd } = getKSTWeekRange()

    // ① 전체 멤버 목록 조회 (등록 순서 유지)
    const { data: members, error: membersError } = await supabase
      .from('members')
      .select('name')
      .order('created_at', { ascending: true })

    if (membersError) throw membersError

    // ② 이번 주 완료된 출석 세션 조회
    //    date 컬럼(YYYY-MM-DD)으로 범위 필터링
    //    duration_seconds가 null인 세션(퇴장 미기록)은 제외
    const { data: sessions, error: sessionsError } = await supabase
      .from('attendance_sessions')
      .select('member_name, duration_seconds')
      .gte('date', weekStart)
      .lte('date', weekEnd)
      .not('duration_seconds', 'is', null)

    if (sessionsError) throw sessionsError

    // ③ 멤버별 duration_seconds 합산
    const secondsMap = {}
    sessions?.forEach(row => {
      if (!row.member_name || !row.duration_seconds) return
      secondsMap[row.member_name] = (secondsMap[row.member_name] || 0) + row.duration_seconds
    })

    // ④ 목표 달성 / 미달성 분류 (전체 멤버 기준)
    const achieved    = []
    const notAchieved = []

    members?.forEach(({ name }) => {
      const total = secondsMap[name] || 0
      const entry = { name, total }

      if (total >= GOAL_SECONDS) {
        achieved.push(entry)
      } else {
        notAchieved.push(entry)
      }
    })

    // 각 그룹 내에서 시간 내림차순 정렬
    achieved.sort((a, b) => b.total - a.total)
    notAchieved.sort((a, b) => b.total - a.total)

    // ⑤ 리포트 문자열 생성
    const totalCount    = members?.length ?? 0
    const achievedCount = achieved.length

    let message = `📚 이번 주 스터디 출석 리포트\n\n`
    message += `기간: ${toKRDateStr(weekStart)} ~ ${toKRDateStr(weekEnd)}\n`
    message += `주간 목표: 5시간`

    if (achieved.length > 0) {
      message += `\n\n✅ 목표 달성`
      achieved.forEach(({ name, total }) => {
        message += `\n- ${name}: ${formatSeconds(total)}`
      })
    }

    if (notAchieved.length > 0) {
      message += `\n\n⚠️ 목표 미달성`
      notAchieved.forEach(({ name, total }) => {
        message += `\n- ${name}: ${formatSeconds(total)}`
      })
    }

    message += `\n\n전체 달성률: ${achievedCount}/${totalCount}명`

    return res.status(200).json({ message })

  } catch (err) {
    console.error('[weekly-report] 오류:', err)
    return res.status(500).json({
      error: err.message || '서버 오류가 발생했습니다.',
    })
  }
}
