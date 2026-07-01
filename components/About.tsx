export function About() {
  return (
    <section className="section" id="about">
      <div className="about-intro">
        <div className="section__head section__head--about">
          <span className="kicker">Center Introduction</span>
          <h2 className="display">
            농협 업무 지원의 <em>새로운 연결 기준</em>을 만듭니다
          </h2>
          <p className="section__lede">
            농협지원센터는 서울에 집중된 전문가 정보 격차를 해소하기 위해
            사업지원서비스 법인 프리고가 설립한, 전국 최초의 농협 전용 지원
            조직입니다.
          </p>
          <p className="section__lede">
            농협 업무에 필요한 전문 지원을 보다 편리하게 연결하고, 다양한
            전문가 네트워크를 바탕으로 전국 각지의 농협이 고도로 전문화된
            지식과 서비스에 폭넓게 접근할 수 있도록 돕습니다.
          </p>
        </div>

        <aside className="about-intro__panel" aria-label="센터 소개 요약">
          <ul className="about-intro__points">
            <li>
              <span className="about-intro__icon" aria-hidden="true">1</span>
              <span className="about-intro__text">
                <strong>전국 최초</strong>
                <span>농협 전용 지원 조직</span>
              </span>
            </li>
            <li>
              <span className="about-intro__icon" aria-hidden="true">8</span>
              <span className="about-intro__text">
                <strong>8대 전문직</strong>
                <span>통합 문의·연결 지원</span>
              </span>
            </li>
            <li>
              <span className="about-intro__icon" aria-hidden="true">✓</span>
              <span className="about-intro__text">
                <strong>원스톱</strong>
                <span>상담·견적·업무 연결</span>
              </span>
            </li>
          </ul>
        </aside>
      </div>

      <div className="about-grid">
        <article className="about-card about-card--lead">
          <h3>
            농협에 필요한 전문지식을 더 쉽고
            <span>폭넓게 연결합니다</span>
          </h3>
          <p>
            농협 업무는 여러 전문 분야가 함께 연결되는 경우가 많습니다.
            농협지원센터는 다양한 전문가 네트워크를 바탕으로 필요한 지원을 보다
            편리하게 시작할 수 있도록 돕습니다.
          </p>
          <ul className="about-card__list">
            <li>전국 농협 특성을 고려한 전문 안내</li>
            <li>8대 분야 전문가 네트워크 직접 연계</li>
            <li>업무 목적에 최적화된 전문가 선정</li>
            <li>상담·견적·업무 연결 원스톱 진행</li>
            <li>후속 상담 및 사후 관리 지속 지원</li>
          </ul>
        </article>

        <aside className="about-card">
          <span className="tag">Value</span>
          <h3>농협이 체감하는 가치</h3>

          <dl className="meta-list">
            <div>
              <dt>전문가 연결</dt>
              <dd>농협 업무에 맞는 전문가를 빠르고 정확하게 연결합니다.</dd>
            </div>
            <div>
              <dt>통합 문의</dt>
              <dd>여러 분야의 전문 문의를 한 곳에서 효율적으로 진행합니다.</dd>
            </div>
            <div>
              <dt>견적 진행</dt>
              <dd>상담 이후 필요한 업무의 견적과 연결 절차까지 함께 진행합니다.</dd>
            </div>
            <div>
              <dt>후속 지원</dt>
              <dd>추가 상담부터 실제 업무 진행까지 지속적으로 지원합니다.</dd>
            </div>
          </dl>
        </aside>
      </div>
    </section>
  );
}
