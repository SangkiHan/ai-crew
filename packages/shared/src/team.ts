// 여러 팀을 만들 수 있게 하는 모델. 팀마다 팀장 대화 세션과 직원 명단이 분리된다.
export interface Team {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  // 이 팀이 담당하는 프로젝트 이름/절대경로 목록 (선택). 팀장 시스템 프롬프트에 그대로 포함된다.
  projects: string[];
}
