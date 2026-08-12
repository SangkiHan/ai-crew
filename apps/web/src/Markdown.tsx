import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// 팀장/직원 응답은 마크다운(제목, 목록, 코드블록, 표 등)으로 오는 경우가 많은데, 그동안 채팅
// 버블에 원문 그대로("**굵게**", "- 목록") 찍혀서 읽기 불편했다. react-markdown은 기본적으로
// raw HTML을 렌더링하지 않아(rehype-raw를 따로 안 붙이면) LLM 출력에 섞여 들어올 수 있는
// <script> 같은 태그가 그대로 실행될 위험이 없다 - 별도 sanitize 없이도 안전하다.
// 컴포넌트별로 채팅 버블(어두운 배경)에 맞는 여백/크기만 얹는다. @tailwindcss/typography
// 플러그인을 새로 추가하는 대신, 이미 쓰는 팔레트(slate/sky)로 직접 스타일링한다.
const COMPONENTS: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  h1: ({ children }) => <h1 className="mb-2 mt-3 text-base font-bold first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-1.5 mt-3 text-sm font-bold first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1 mt-2 text-sm font-semibold first:mt-0">{children}</h3>,
  ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-0.5 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-0.5 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-slate-100">{children}</strong>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-sky-400 underline hover:text-sky-300">
      {children}
    </a>
  ),
  code: ({ className, children }) => {
    // 코드블록(```)은 language-* 클래스가 붙어서 온다 - 그걸로 인라인 코드와 구분한다.
    const isBlock = /language-/.test(className ?? "");
    if (isBlock) {
      return <code className={className}>{children}</code>;
    }
    return <code className="rounded bg-black/30 px-1 py-0.5 font-mono text-[0.85em]">{children}</code>;
  },
  pre: ({ children }) => (
    <pre className="mb-2 overflow-x-auto rounded-md bg-black/30 p-2 font-mono text-xs last:mb-0">{children}</pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-2 border-l-2 border-slate-600 pl-2 text-slate-400 last:mb-0">{children}</blockquote>
  ),
  hr: () => <hr className="my-2 border-slate-700" />,
  table: ({ children }) => (
    <div className="mb-2 overflow-x-auto last:mb-0">
      <table className="border-collapse text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-slate-700 px-2 py-1 text-left">{children}</th>,
  td: ({ children }) => <td className="border border-slate-700 px-2 py-1">{children}</td>,
};

export function Markdown({ text }: { text: string }) {
  return (
    <div className="text-sm leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
