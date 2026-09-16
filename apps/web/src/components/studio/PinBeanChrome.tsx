'use client';

import React from 'react';

export type StudioStep = 'import' | 'generate' | 'refine' | 'make';

const steps: Array<{ id: StudioStep; index: string; label: string; hint: string }> = [
  { id: 'import', index: '01', label: '导入', hint: '选择素材' },
  { id: 'generate', index: '02', label: '生成', hint: '调整图纸' },
  { id: 'refine', index: '03', label: '校对', hint: '修正细节' },
  { id: 'make', index: '04', label: '制作', hint: '按色开拼' },
];

export function PinBeanHeader({
  hasProject,
  onNewProject,
  onHelp,
}: {
  hasProject: boolean;
  onNewProject: () => void;
  onHelp: () => void;
}) {
  return (
    <header className="pinbean-topbar">
      <div className="pinbean-brand" aria-label="PinBean 拼豆制作台">
        <div className="pinbean-mark" aria-hidden="true">
          {['#F06449', '#E9B949', '#397568', '#F7C9B8', '#292521', '#F06449', '#397568', '#E9B949', '#F7C9B8'].map((color, index) => (
            <span key={`${color}-${index}`} style={{ backgroundColor: color }} />
          ))}
        </div>
        <div>
          <strong>PinBean</strong>
          <small>拼豆制作台</small>
        </div>
      </div>

      <div className="pinbean-topbar-copy">
        <span className="pinbean-eyebrow">FROM IMAGE TO PEGBOARD</span>
        <p>把图片变成真正能开拼的图纸</p>
      </div>

      <div className="pinbean-topbar-actions">
        <button type="button" className="pinbean-button pinbean-button-quiet" onClick={onHelp}>
          使用说明
        </button>
        {hasProject && (
          <button type="button" className="pinbean-button pinbean-button-secondary" onClick={onNewProject}>
            换一张图
          </button>
        )}
      </div>
    </header>
  );
}

export function WorkflowSteps({
  activeStep,
  enabledSteps,
  onStepChange,
}: {
  activeStep: StudioStep;
  enabledSteps: StudioStep[];
  onStepChange: (step: StudioStep) => void;
}) {
  return (
    <nav className="pinbean-workflow" aria-label="制作流程">
      {steps.map((step) => {
        const active = activeStep === step.id;
        const enabled = enabledSteps.includes(step.id);
        return (
          <button
            key={step.id}
            type="button"
            disabled={!enabled}
            className={`pinbean-workflow-step ${active ? 'is-active' : ''}`}
            onClick={() => onStepChange(step.id)}
          >
            <span className="pinbean-step-index">{step.index}</span>
            <span>
              <strong>{step.label}</strong>
              <small>{step.hint}</small>
            </span>
          </button>
        );
      })}
    </nav>
  );
}

export function ProjectStart({
  ready,
  onUpload,
  onDrop,
  onDragOver,
}: {
  ready: boolean;
  onUpload: () => void;
  onDrop: React.DragEventHandler<HTMLDivElement>;
  onDragOver: React.DragEventHandler<HTMLDivElement>;
}) {
  return (
    <section className="pinbean-start">
      <div className="pinbean-start-copy">
        <span className="pinbean-kicker">新建一张拼豆图纸</span>
        <h1>从一张喜欢的图片开始，<br />今天就把它拼出来。</h1>
        <p>PinBean 会完成颜色匹配、用量统计和施工图导出。你只需要选素材、看结果、做少量校对。</p>
        <div className="pinbean-use-cases" aria-label="适合制作的作品">
          {['头像', '挂件', '礼物', '人物照片'].map((item) => <span key={item}>{item}</span>)}
        </div>
      </div>

      <div
        className={`pinbean-dropzone ${ready ? '' : 'is-waiting'}`}
        onClick={ready ? onUpload : undefined}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragEnter={onDragOver}
        role="button"
        tabIndex={ready ? 0 : -1}
        onKeyDown={(event) => {
          if (ready && (event.key === 'Enter' || event.key === ' ')) onUpload();
        }}
      >
        <div className="pinbean-drop-illustration" aria-hidden="true">
          <span /><span /><span /><span /><span /><span /><span /><span /><span />
        </div>
        <strong>上传图片开始制作</strong>
        <p>点击选择，或把 JPG / PNG / CSV 拖到这里</p>
        <span className="pinbean-upload-cta">选择文件</span>
      </div>
    </section>
  );
}

export function ProjectSummary({
  dimensions,
  beadCount,
  colorCount,
}: {
  dimensions: { N: number; M: number } | null;
  beadCount: number;
  colorCount: number;
}) {
  const boardCount = dimensions
    ? Math.ceil(dimensions.N / 29) * Math.ceil(dimensions.M / 29)
    : 0;

  return (
    <div className="pinbean-summary" aria-label="图纸概览">
      <div><small>图纸尺寸</small><strong>{dimensions ? `${dimensions.N} × ${dimensions.M}` : '处理中'}</strong></div>
      <div><small>拼豆数量</small><strong>{beadCount ? beadCount.toLocaleString() : '—'}</strong></div>
      <div><small>使用颜色</small><strong>{colorCount ? `${colorCount} 色` : '—'}</strong></div>
      <div><small>预计拼板</small><strong>{boardCount ? `${boardCount} 块` : '—'}</strong></div>
    </div>
  );
}
