// 여러 팀을 만들 수 있게 하는 모델. 팀마다 팀장 대화 세션과 직원 명단이 분리된다.
export interface Team {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}
