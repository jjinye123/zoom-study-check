// src/lib/supabase.js
// Supabase 클라이언트 초기화
// anon(publishable) key만 사용 — service_role key는 절대 사용하지 않습니다

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error(
    '[Supabase] 환경 변수가 설정되지 않았습니다.\n' +
    '.env.local 파일에 VITE_SUPABASE_URL과 VITE_SUPABASE_PUBLISHABLE_KEY를 입력해주세요.'
  )
}

export const supabase = createClient(supabaseUrl, supabaseKey)
