/**
 * 樱梦 Sakura Dream —— 壁纸配置文件
 * ------------------------------------------------------------
 * 修改后刷新页面即可生效。
 *
 * 单位约定（保证不同分辨率下观感一致）：
 *   - 「H」= 屏幕高度。例如 0.012 H ≈ 1080p 下 13 像素。
 *   - 图片坐标 [x, y] 为 0~1 的比例，左上角为 [0, 0]。
 *   - 速度类参数为倍率，1 = 默认。
 *
 * 在 Wallpaper Engine 中：属性面板里暴露的参数会覆盖这里的同名默认值；
 * 未暴露的高级参数（木偶区域、颜色细节、焦点等）只在本文件中修改。
 */
window.WALLPAPER_CONFIG = {
  /* ========== 素材 ========== */
  image: {
    // 主插画。数组表示按顺序尝试，第一个能加载的生效；都失败时使用内置占位图
    background: ['assets/main.png', 'assets/main.jpg', 'assets/main.webp'],
    // —— 以下为可选分层素材，需与主插画「同尺寸、像素对齐」，没有就保持 null ——
    foreground: null, // 角色/前景层（透明 PNG）。提供后角色有独立视差，远景花瓣会落在角色身后
    depth: null, // 深度图（灰度：白=近，黑=远）。提供后画面内部产生 2.5D 视差
    motionMask: null, // 木偶遮罩（白=允许摆动，黑=固定）。提供后木偶效果只作用于白色区域
    focus: [0.5, 0.42], // 屏幕比例与插画不一致时，裁切优先保留的位置 [x, y]
    maxTextureSize: 0, // 0 = 自动按屏幕分辨率缩小超大图（省显存）；也可填像素上限，如 3840
  },

  /* ========== 镜头 ========== */
  camera: {
    breathe: {
      enabled: true,
      zoom: 0.01, // 呼吸缩放幅度（0.01 = 1%）
      period: 11, // 一次呼吸的秒数
      drift: 0.003, // 伴随的极缓慢平移幅度（H）
      focus: [0.5, 0.45], // 缩放中心（屏幕比例），可对准角色脸部
    },
    parallax: {
      enabled: true,
      mouse: true, // 跟随鼠标
      amount: 0.012, // 背景层最大位移（H）
      smoothing: 1.6, // 跟随柔和度，越小越「慢」
      idleDrift: 0.35, // 鼠标静止/不可用时的自动漂移比例（0 关闭）
      invert: true, // true：画面向鼠标反方向移动（更像透过窗户看）
      foreground: 1.6, // 前景层（提供 foreground 素材时）相对背景的视差倍率
      depth: 0.01, // 深度图视差强度（H，提供 depth 素材时生效）
    },
  },

  /* ========== 风 ========== */
  wind: {
    strength: 0.5, // 基础风力
    direction: 1, // 1 = 向右吹，-1 = 向左吹
    gust: 0.6, // 阵风强度（0 = 恒定风）
    gustPeriod: 14, // 阵风变化的大致周期（秒）
  },

  /* ========== 樱花花瓣 ========== */
  petals: {
    enabled: true,
    count: 70, // 同屏花瓣数量
    speed: 1.0, // 下落速度倍率
    size: 1.0, // 尺寸倍率
    farRatio: 0.45, // 远景小花瓣占比（虚化、半透明、视差小）
    nearRatio: 0.06, // 前景大花瓣占比（强虚化、视差大）——克制一点更高级
    spin: 1.0, // 旋转/翻转速度倍率
    sway: 1.0, // 左右摇摆幅度倍率
    opacity: 1.0, // 整体不透明度
    tint: [1, 1, 1], // 颜色乘数 [r, g, b]，例如 [1, 0.95, 0.97] 更粉
  },

  /* ========== 光斑（散景） ========== */
  bokeh: {
    enabled: true,
    count: 10,
    size: 1.0,
    intensity: 0.5,
    speed: 1.0,
    nearLight: 0.6, // 聚集在光源附近的比例
    colors: [
      [1.0, 0.93, 0.88],
      [1.0, 0.84, 0.9],
      [1.0, 0.96, 0.84],
    ],
  },

  /* ========== 漂浮光尘 ========== */
  motes: {
    enabled: true,
    count: 40,
    size: 1.0,
    intensity: 0.6,
    speed: 1.0,
    sparkle: 0.12, // 带十字星芒的比例
    color: [1.0, 0.95, 0.86],
  },

  /* ========== 光效 / 后处理（WebGL） ========== */
  light: {
    bloom: {
      enabled: true,
      intensity: 0.35, // 泛光强度
      threshold: 0.72, // 亮度阈值，越低越「梦幻」
      knee: 0.25, // 阈值过渡柔和度
      levels: 5, // 模糊层级（越大光晕越宽）
      tint: [1.0, 0.96, 0.97],
    },
    sun: {
      enabled: true,
      position: [0.16, -0.02], // 光源位置（屏幕比例，可超出 0~1 表示在画面外）
      color: [1.0, 0.9, 0.82],
      intensity: 0.28,
      radius: 0.75, // 光晕范围
      pulse: 0.15, // 明暗呼吸幅度
      pulsePeriod: 9,
      follow: 0.6, // 光源跟随视差的比例
    },
    rays: {
      intensity: 0.07, // 光束（丁达尔）强度，0 关闭
      density: 1.0,
      speed: 1.0,
    },
    vignette: {
      intensity: 0.28,
      radius: 0.85,
      color: [0.36, 0.24, 0.32], // 暗角颜色（偏暖紫比纯黑更柔和）
    },
    grade: {
      brightness: 0.0, // -0.2 ~ 0.2
      contrast: 1.0,
      saturation: 1.0,
      haze: 0.0, // 梦幻柔雾（提亮暗部），0 ~ 1
      hazeColor: [1.0, 0.93, 0.96],
    },
  },

  /* ========== 木偶摆动（头发末梢 / 衣袖） ========== */
  puppet: {
    enabled: true,
    strength: 1.0, // 全局幅度倍率
    speed: 1.0, // 全局速度倍率
    windResponse: 0.5, // 对阵风的响应（让头发与花瓣「同一阵风」）
    // 摆动区域：建议用编辑器（浏览器打开后按 E → 「木偶」页）可视化放置后导出粘贴到这里。
    // 坐标为插画比例；radius / amplitude 以插画高度为单位。示例：
    // {
    //   name: '左侧发梢',
    //   pivot: [0.42, 0.3],   // 根部（固定不动的点）
    //   center: [0.4, 0.46],  // 摆动中心（从根部到这里摆幅逐渐增大）
    //   radius: 0.09,         // 影响范围
    //   feather: 0.35,        // 边缘羽化（0~0.95，越小越柔）
    //   amplitude: 0.004,     // 摆幅
    //   speed: 0.22,          // 每秒摆动次数
    //   wave: 1.6,            // 波动传递（越大越像柔软的发丝）
    //   angle: 0,             // 摆动方向偏转（度），0 = 垂直于 根部→中心
    //   phase: 0,             // 相位，错开多个区域
    //   lean: 0.5,            // 顺风倾斜程度
    // },
    zones: [],
  },

  /* ========== 性能 ========== */
  performance: {
    quality: 'medium', // low = 流畅，medium = 均衡，high = 高画质
    fps: 30, // 帧率上限。安静的画面 30fps 足够顺滑，也更省电
    renderScale: 1.0, // 渲染分辨率倍率（弱显卡可设 0.75）
    maxPixelRatio: 2, // 高 DPI 屏幕的像素比上限
    pauseWhenHidden: true,
    powerPreference: 'default', // 笔记本可设 'low-power'
  },

  debug: {
    showFps: false,
  },
};
