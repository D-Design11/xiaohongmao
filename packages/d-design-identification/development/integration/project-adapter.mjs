import { classifyCanvas, resolveConstraints } from '../../runtime/extreme.mjs';

/** Map one existing D-Design material to the new interface. Does not mutate or save a project. */
export function resolveProjectMaterial(project, material, bundle) {
  const canvas = { width: material.w, height: material.h, unit: material.unit };
  const route = classifyCanvas(canvas);
  if (route === 'regular') return { route, message: '交给原有常规版式模块处理。' };
  if (route !== 'extreme-supported') return { route, ok: false, issues: [{ code: 'unsupported-canvas', message: '当前极端规则仅支持6:1或1:6。' }] };
  // Use selected, renderer-verified asset metadata for partners; do not trust unchecked client dimensions.
  const result = resolveConstraints({
    canvas,
    preset: material.splitPreset ?? project.splitPreset ?? 'M',
    title: project.title,
    subtitle: project.subtitle ?? '',
    structure: 'brand-pillar',
    ...(material.extremeBrandVariant ? { brandVariant: material.extremeBrandVariant } : {}),
    ...(material.informationPlacement ? { informationPlacement: material.informationPlacement } : {}),
    qrEnabled: false,
    qr: null,
    partners: material.resolvedPartners ?? []
  }, bundle.rules, bundle.common);
  return { route, ...result, provenance: bundle.provenance,
    notes: project.url ? ['旧项目链接保留为项目元数据；未传入极端尺寸渲染器，不生成二维码。'] : [] };
}
