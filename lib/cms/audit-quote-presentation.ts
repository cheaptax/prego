import type { CmsHomeSectionPresentation } from "@/lib/cms/home-presentation";

export const CMS_AUDIT_QUOTE_SECTION_PRESENTATION: Record<
  string,
  CmsHomeSectionPresentation
> = {
  hero: {
    name: "첫 화면",
    eyebrowLabel: "페이지 배지",
    titleLabel: "첫 화면 큰 제목",
    descriptionLabel: "첫 화면 설명",
    textFields: {
      highlight: {
        label: "강조 문구",
        help: "큰 제목 안에서 강조할 문구입니다.",
      },
    },
  },
  intakeForm: {
    name: "견적 신청 영역",
    titleLabel: "관리자 목록 이름",
    textFields: {
      formTitle: {
        label: "신청 영역 제목",
        help: "비워 두면 현재처럼 제목 없이 신청 항목부터 표시됩니다.",
      },
      formDescription: {
        label: "신청 영역 안내",
        help: "비워 두면 별도 안내를 표시하지 않습니다.",
      },
      formAriaLabel: {
        label: "신청 영역 접근성 이름",
        help: "화면 읽기 프로그램이 이 영역을 구분할 때 사용합니다.",
      },
      targetCooperativeLabel: {
        label: "대상 농협명 표시 이름",
        help: "내부 입력 이름과 저장 필드는 바뀌지 않습니다.",
      },
      targetCooperativePlaceholder: {
        label: "대상 농협명 입력 예시",
        help: "입력칸 안에 흐리게 표시되는 예시입니다.",
      },
      targetCooperativeHelp: {
        label: "대상 농협명 도움말",
        help: "비워 두면 도움말을 표시하지 않습니다.",
      },
      fiscalYearLabel: {
        label: "사업연도 표시 이름",
        help: "내부 입력 이름과 저장 필드는 바뀌지 않습니다.",
      },
      fiscalYearPlaceholder: {
        label: "사업연도 입력 예시",
        help: "입력칸 안에 흐리게 표시되는 예시입니다.",
      },
      fiscalYearHelp: {
        label: "사업연도 도움말",
        help: "비워 두면 도움말을 표시하지 않습니다.",
      },
      emailLabel: {
        label: "이메일 표시 이름",
        help: "내부 입력 이름과 저장 필드는 바뀌지 않습니다.",
      },
      emailPlaceholder: {
        label: "이메일 입력 예시",
        help: "입력칸 안에 흐리게 표시되는 예시입니다.",
      },
      emailHelp: {
        label: "이메일 도움말",
        help: "비워 두면 도움말을 표시하지 않습니다.",
      },
      nameLabel: {
        label: "담당자 이름 표시 이름",
        help: "내부 입력 이름과 저장 필드는 바뀌지 않습니다.",
      },
      namePlaceholder: {
        label: "담당자 이름 입력 예시",
        help: "입력칸 안에 흐리게 표시되는 예시입니다.",
      },
      nameHelp: {
        label: "담당자 이름 도움말",
        help: "비워 두면 도움말을 표시하지 않습니다.",
      },
      phoneLabel: {
        label: "휴대폰 번호 표시 이름",
        help: "내부 입력 이름과 저장 필드는 바뀌지 않습니다.",
      },
      phonePlaceholder: {
        label: "휴대폰 번호 입력 예시",
        help: "입력칸 안에 흐리게 표시되는 예시입니다.",
      },
      phoneHelp: {
        label: "휴대폰 번호 도움말",
        help: "비워 두면 도움말을 표시하지 않습니다.",
      },
      privacyConsentLabel: {
        label: "개인정보 수집·이용 동의 문구",
        help: "필수 여부는 보호되어 있으며 관리자가 바꿀 수 없습니다.",
      },
      privacyConsentLinkLabel: {
        label: "개인정보 안내 링크 문구",
        help: "연결 주소와 개인정보 처리 기준 버전은 운영 설정으로 보호됩니다.",
      },
      marketingConsentLabel: {
        label: "이벤트·혜택 수신 동의 문구",
        help: "선택 동의의 저장 방식은 바뀌지 않습니다.",
      },
      submitLabel: {
        label: "신청 버튼 문구",
        help: "버튼을 눌렀을 때 실행되는 저장 기능은 바뀌지 않습니다.",
      },
      freeNotice: {
        label: "무료 신청 및 계약 의무 안내",
        help: "신청 버튼 아래에 표시됩니다.",
      },
    },
    legalWarning:
      "개인정보 필수 동의 문구가 포함된 영역입니다. 문구 변경은 이력에 남으며, 필수 여부·저장 키·제출 기능은 변경되지 않습니다.",
  },
  benefits: {
    name: "제공 혜택",
    titleLabel: "혜택 영역 제목",
    itemFields: {
      title: "혜택 이름",
      description: "혜택 설명",
    },
    textFields: {
      ariaLabel: {
        label: "혜택 영역 접근성 이름",
        help: "화면 읽기 프로그램에서 사용하는 영역 이름입니다.",
      },
    },
  },
  steps: {
    name: "진행 순서",
    titleLabel: "진행 순서 영역 제목",
    itemFields: {
      title: "단계 이름",
      description: "단계 설명",
    },
    textFields: {
      ariaLabel: {
        label: "진행 순서 접근성 이름",
        help: "화면 읽기 프로그램에서 사용하는 영역 이름입니다.",
      },
    },
  },
  faq: {
    name: "자주 묻는 질문",
    titleLabel: "FAQ 영역 제목",
    itemFields: {
      title: "질문",
      description: "답변",
    },
    textFields: {
      ariaLabel: {
        label: "FAQ 영역 접근성 이름",
        help: "화면 읽기 프로그램에서 사용하는 영역 이름입니다.",
      },
    },
  },
  legalNotice: {
    name: "운영 주체와 면책문구",
    titleLabel: "관리자 목록 이름",
    descriptionLabel: "필수 면책문구",
    textFields: {
      operatorName: {
        label: "운영 주체",
        help: "공개 화면에서 굵게 표시됩니다.",
      },
      ariaLabel: {
        label: "운영 안내 접근성 이름",
        help: "화면 읽기 프로그램에서 사용하는 영역 이름입니다.",
      },
    },
    legalWarning:
      "법적·운영상 필수 안내입니다. 문구 변경은 이력에 남으며 게시 전 경고가 표시됩니다. 이 영역은 숨기거나 삭제할 수 없습니다.",
  },
};

export const CMS_AUDIT_QUOTE_MESSAGE_PRESENTATION: Record<
  string,
  { label: string; help: string }
> = {
  closedTitle: {
    label: "접수 기간 종료 제목",
    help: "이벤트 접수가 비활성화되었을 때 표시됩니다.",
  },
  closedDescription: {
    label: "접수 기간 종료 안내",
    help: "이벤트 접수가 비활성화되었을 때 표시됩니다.",
  },
  submitting: {
    label: "신청 버튼 처리 중 문구",
    help: "견적 요청을 보내는 동안 버튼에 표시됩니다.",
  },
  submittingStatus: {
    label: "접수 처리 중 접근성 안내",
    help: "화면 읽기 프로그램에 전달되는 처리 중 상태입니다.",
  },
  successTitle: {
    label: "신청 완료 제목",
    help: "견적 요청이 정상 접수되었을 때 표시됩니다.",
  },
  successDescription: {
    label: "신청 완료 안내",
    help: "신청 완료 제목 아래에 표시됩니다.",
  },
  temporaryMemberNotice: {
    label: "임시회원과 견적 확인 경로 안내",
    help: "견적 요청 완료 후 자동 계정과 견적 도착 메일 이용 방법을 안내합니다.",
  },
  temporaryMemberSecurityNotice: {
    label: "임시회원 비밀번호 보안 안내",
    help: "평문 임시비밀번호 대신 일회용 설정 링크를 사용한다는 안내입니다.",
  },
  publicReferenceLabel: {
    label: "접수번호 이름",
    help: "서버가 발급한 접수번호 앞에 표시됩니다.",
  },
  resetLabel: {
    label: "다른 담당자로 신청 버튼",
    help: "완료 화면에서 입력 화면으로 돌아가는 버튼입니다.",
  },
  targetCooperativeRequired: {
    label: "대상 농협명 미입력 안내",
    help: "대상 농협명을 비워 둔 경우 표시됩니다.",
  },
  targetCooperativeInvalid: {
    label: "대상 농협명 형식 오류 안내",
    help: "대상 농협명 길이가 허용 범위를 벗어난 경우 표시됩니다.",
  },
  fiscalYearRequired: {
    label: "사업연도 미입력 안내",
    help: "감사 대상 사업연도를 비워 둔 경우 표시됩니다.",
  },
  fiscalYearInvalid: {
    label: "사업연도 형식 오류 안내",
    help: "사업연도가 허용 범위를 벗어난 경우 표시됩니다.",
  },
  emailRequired: {
    label: "이메일 미입력 안내",
    help: "이메일을 비워 둔 경우 표시됩니다.",
  },
  emailInvalid: {
    label: "이메일 형식 오류 안내",
    help: "허용된 농협 이메일이 아닌 경우 표시됩니다.",
  },
  nameRequired: {
    label: "담당자 이름 미입력 안내",
    help: "담당자 이름을 비워 둔 경우 표시됩니다.",
  },
  nameInvalid: {
    label: "담당자 이름 형식 오류 안내",
    help: "담당자 이름 형식이 올바르지 않은 경우 표시됩니다.",
  },
  phoneRequired: {
    label: "휴대폰 번호 미입력 안내",
    help: "휴대폰 번호를 비워 둔 경우 표시됩니다.",
  },
  phoneInvalid: {
    label: "휴대폰 번호 형식 오류 안내",
    help: "휴대폰 번호 형식이 올바르지 않은 경우 표시됩니다.",
  },
  consentRequired: {
    label: "필수 동의 누락 안내",
    help: "개인정보 수집·이용에 동의하지 않은 경우 표시됩니다.",
  },
  privacyVersionMismatch: {
    label: "개인정보 동의 기준 변경 안내",
    help: "서버의 동의 기준 버전이 바뀐 경우 표시됩니다.",
  },
  eventDisabled: {
    label: "접수 중단 오류 안내",
    help: "입력 중 접수가 중단된 경우 표시됩니다.",
  },
  rateLimited: {
    label: "신청 횟수 제한 안내",
    help: "보호 기준보다 요청이 많은 경우 표시됩니다.",
  },
  requestRejected: {
    label: "보호 정책 거절 안내",
    help: "요청 형식 또는 출처가 허용되지 않은 경우 표시됩니다.",
  },
  genericError: {
    label: "일반 전송 실패 안내",
    help: "네트워크 문제 등 별도 안내가 없는 실패에 표시됩니다.",
  },
};
