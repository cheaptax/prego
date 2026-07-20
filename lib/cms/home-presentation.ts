export type CmsHomeSectionPresentation = {
  name: string;
  legalWarning?: string;
  eyebrowLabel?: string;
  titleLabel: string;
  descriptionLabel?: string;
  textFields?: Record<string, { label: string; help: string }>;
  itemFields?: {
    label?: string;
    title: string;
    description?: string;
    value?: string;
  };
  groups?: Record<
    string,
    {
      name: string;
      label?: string;
      title?: string;
      description?: string;
      itemFields?: {
        label?: string;
        title: string;
        description?: string;
        value?: string;
      };
    }
  >;
};

export const CMS_HOME_SECTION_PRESENTATION: Record<
  string,
  CmsHomeSectionPresentation
> = {
  hero: {
    name: "첫 화면",
    eyebrowLabel: "첫 화면 배지",
    titleLabel: "첫 화면 큰 제목",
    descriptionLabel: "첫 화면 설명",
    textFields: {
      highlight: {
        label: "강조 문구",
        help: "큰 제목에서 파란색으로 강조해 표시됩니다.",
      },
    },
    groups: {
      serviceSummary: {
        name: "서비스 요약 수치",
        itemFields: {
          title: "수치 또는 핵심 문구",
          description: "수치 설명",
        },
      },
    },
  },
  about: {
    name: "센터 소개",
    eyebrowLabel: "영문 안내",
    titleLabel: "센터 소개 큰 제목",
    descriptionLabel: "센터 소개 첫 문단",
    textFields: {
      highlight: {
        label: "제목 강조 문구",
        help: "센터 소개 큰 제목에서 파란색으로 표시됩니다.",
      },
      secondaryDescription: {
        label: "센터 소개 둘째 문단",
        help: "첫 문단 바로 아래에 이어서 표시됩니다.",
      },
    },
    groups: {
      introductionSummary: {
        name: "센터 소개 요약",
        label: "접근성 설명",
        itemFields: {
          value: "표시 기호",
          title: "핵심 문구",
          description: "보충 설명",
        },
      },
      supportPromise: {
        name: "센터 지원 방식",
        label: "제목 둘째 줄",
        title: "지원 방식 제목",
        description: "지원 방식 설명",
        itemFields: { title: "지원 항목" },
      },
      customerValue: {
        name: "농협이 체감하는 가치",
        label: "작은 분류",
        title: "가치 영역 제목",
        itemFields: {
          title: "가치 이름",
          description: "가치 설명",
        },
      },
    },
  },
  expertise: {
    name: "전문성 카드",
    eyebrowLabel: "영문 안내",
    titleLabel: "전문성 영역 제목",
    descriptionLabel: "전문성 영역 설명",
    textFields: {
      highlight: {
        label: "제목 강조 문구",
        help: "전문성 영역 제목에서 파란색으로 표시됩니다.",
      },
    },
    itemFields: {
      value: "카드 강조 문구",
      title: "전문성 카드 제목",
      description: "전문성 카드 설명",
    },
  },
  services: {
    name: "지원 분야 전체 카드",
    eyebrowLabel: "영문 안내",
    titleLabel: "지원 분야 큰 제목",
    descriptionLabel: "지원 분야 설명",
    textFields: {
      highlight: {
        label: "제목 강조 문구",
        help: "지원 분야 큰 제목에서 파란색으로 표시됩니다.",
      },
    },
    itemFields: {
      title: "지원 분야 이름",
      description: "지원 분야 설명",
    },
    groups: {
      multiFieldRequest: {
        name: "복합 문의 안내",
        label: "안내 배지",
        title: "복합 문의 안내문",
      },
    },
  },
  process: {
    name: "상담 흐름 STEP 01~04",
    eyebrowLabel: "인용 출처",
    titleLabel: "상담 흐름 강조문",
    textFields: {
      highlight: {
        label: "강조 문구",
        help: "상담 흐름 문구에서 파란색으로 표시됩니다.",
      },
      captionSuffix: {
        label: "출처 보충 문구",
        help: "인용 출처 옆에 표시됩니다.",
      },
      ariaLabel: {
        label: "화면 읽기용 설명",
        help: "화면 읽기 도구가 이 영역을 설명할 때 사용합니다.",
      },
    },
    itemFields: {
      label: "단계 번호",
      title: "단계 제목",
      description: "단계 설명",
    },
  },
  caseStudies: {
    name: "문의게시판 안내",
    eyebrowLabel: "작은 안내",
    titleLabel: "문의게시판 안내 제목",
    descriptionLabel: "문의게시판 안내 설명",
    textFields: {
      highlight: {
        label: "제목 강조 문구",
        help: "문의게시판 안내 제목에서 파란색으로 표시됩니다.",
      },
    },
    itemFields: {
      label: "공개 범위",
      title: "안내 카드 제목",
      description: "안내 카드 설명",
    },
  },
  faqPreview: {
    name: "자주 묻는 질문",
    eyebrowLabel: "영문 안내",
    titleLabel: "자주 묻는 질문 제목",
    textFields: {
      highlight: {
        label: "제목 강조 문구",
        help: "질문 영역 제목에서 파란색으로 표시됩니다.",
      },
      listTitle: {
        label: "목록 제목",
        help: "질문 목록 바로 위에 표시됩니다.",
      },
    },
    itemFields: {
      label: "질문 분류",
      title: "질문",
      description: "답변",
    },
  },
};
