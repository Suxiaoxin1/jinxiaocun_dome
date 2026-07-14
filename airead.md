﻿# 项目演示部署操作指引

> 从拿到一个完整项目，到提取前端页面、简单交互效果和简单功能，最终部署到 GitHub 仓库生成公网演示地址的完整流程。

---

## 整体流程概览

```
第1步：判断项目类型与平台架构（关键分支点）
  ├── 小程序项目（微信/支付宝/百度/抖音/uni-app/Taro...） → 第2A步 → 第3A步 → 第4A步
  ├── APP 项目（原生/Hybrid/uni-app/Flutter/Taro/React Native...） → 第2C步 → 第3C步 → 第4C步
  └── 网站项目（纯静态/Vue/React/Next.js/Nuxt/Svelte...）   → 第2B步 → 第3B步 → 第4B步
第5步：处理数据层（共享）
第6步：编译构建并预览（共享）
第7步：部署到 GitHub Pages（共享）
```

---

## 项目类型速查表

Agent 在第 1 步需要识别项目的**类型**和**平台/架构**，以下速查表帮助快速判断：

### 小程序项目识别

| 平台 | 特征文件/后缀 | 模板语法 | 样式后缀 | API 前缀 |
|------|-------------|---------|---------|---------|
| 微信小程序 | `app.json` `app.js` `.wxml` | `wx:if` `wx:for` `{{}}` | `.wxss` | `wx.` |
| 支付宝小程序 | `app.json` `app.js` `.axml` | `a:if` `a:for` `{{}}` | `.acss` | `my.` |
| 百度小程序 | `app.json` `app.js` `.swan` | `s-if` `s-for` `{{}}` | `.css` | `swan.` |
| 抖音小程序 | `app.json` `app.js` `.ttml` | `tt:if` `tt:for` `{{}}` | `.ttss` | `tt.` |
| uni-app 项目 | `pages.json` `manifest.json` `.vue` | `v-if` `v-for` `{{}}` | `.vue <style>` | `uni.` |
| Taro 项目 | `app.config.ts` `.tsx` | JSX | `.scss/.less` | `Taro.` |

> **统一迁移方案**：所有小程序平台最终都迁移到 **uni-app** 项目，编译输出为 H5。不同平台的模板语法和 API 前缀会在第 3A 步统一转换。

### 网站项目识别

| 架构 | 特征文件 | 构建工具 | 路由方案 |
|------|---------|---------|---------|
| 纯静态网站 | `.html` `.css` `.js` | 无 | 多页面直接跳转 |
| Vue 2/3 + Vite/Webpack | `.vue` `vite.config.js` / `webpack.config.js` | Vite/Webpack | Vue Router |
| React + Vite/Webpack | `.jsx` `.tsx` | Vite/Webpack | React Router |
| Next.js | `next.config.js` `page.tsx` | Next.js 内置 | 文件系统路由 |
| Nuxt.js | `nuxt.config.js` `.vue` | Nuxt 内置 | 文件系统路由 |
| Svelte/SvelteKit | `.svelte` `svelte.config.js` | Vite | SvelteKit 路由 |

> **统一迁移方案**：保留原架构不动，只需去除后端依赖、替换 API 为 mock 数据、配置构建输出即可。

### APP 项目识别

| 平台/框架 | 特征文件/后缀 | 技术栈 | 路由方案 | 统一处理方案 |
|-----------|-------------|--------|---------|------------|
| 原生 Android | `build.gradle` `.kt` `.xml` | Kotlin/Java + XML | Activity/Fragment | 提取核心页面用 HTML/CSS/JS 重写为 H5 |
| 原生 iOS | `.swift` `.storyboard` `.xcodeproj` | Swift/Objective-C | ViewController | 提取核心页面用 HTML/CSS/JS 重写为 H5 |
| uni-app | `pages.json` `manifest.json` `.vue` | Vue + uni-app | 文件系统路由 | 直接编译为 H5 |
| Taro | `app.config.ts` `.tsx` | React + Taro | 文件系统路由 | 直接编译为 H5 |
| Flutter | `pubspec.yaml` `.dart` | Dart + Flutter | Navigator | 提取 UI 用 HTML/CSS/JS 重写为 H5 |
| React Native | `package.json` `.jsx` `.ios/.android` | React Native | React Navigation | 提取核心页面用 HTML/CSS/JS 重写为 H5 |
| Hybrid App | `WebView` + 原生壳 | HTML/CSS/JS | 多页面/单页面 | 直接提取 WebView 内的 H5 内容 |

> **统一迁移方案**：APP 项目最终目标是生成可在浏览器打开的 H5 演示页面。对于 uni-app/Taro 项目可直接编译；对于原生/Hybrid/Flutter/React Native 项目，需要提取核心页面，用 HTML/CSS/JS 重写为纯前端 H5 演示项目。

---

## 第 1 步：分析项目结构，判断项目类型与平台架构

**目标**：让 Agent 理解项目全貌，**明确判断项目类型和具体平台/架构**，决定后续走哪个分支及子方案。

### 提示词

```text
你是一个前端项目分析与迁移专家。现在我会把我的项目文件结构发给你。
请先阅读所有文件，分析并回答以下内容：

【项目类型判断】（必须首先明确回答）
- 如果项目是小程序 → 回答「小程序」+ 具体平台（微信/支付宝/百度/抖音/uni-app/Taro/其他），后续走 A 分支
- 如果项目是 APP   → 回答「APP」+ 具体平台/框架（原生 Android/iOS/uni-app/Taro/Flutter/React Native/Hybrid/其他），后续走 C 分支
- 如果项目是网站   → 回答「网站」+ 具体架构（纯静态/Vue/React/Next.js/Nuxt/Svelte/其他），后续走 B 分支

【项目结构分析】
1. 所有页面路径和对应的文件名（列出完整清单，包括页面数量）；
2. 路由配置（小程序的 tabBar / 网站的路由结构）；
3. 全局样式文件中的关键样式；
4. 每个页面用到的数据来源（静态数据 / API 请求 / 本地存储）；
5. 是否有自定义组件，以及它们的路径和数量；
6. 是否依赖后端接口（列出所有 API 地址和用途）；
7. 项目复杂度评估（简单：1~3 个页面 / 中等：4~8 个页面 / 复杂：8 个以上页面）。

请先明确回答项目类型和平台/架构，再用清单形式列出分析结果，不需要写代码。
```

### 预期效果

Agent 会首先明确项目类型和具体平台/架构，然后输出分析结果：

**示例 1 — 小程序项目**：

```text
项目类型：小程序 - 微信平台
页面数量：5 个（中等复杂度）

页面：
- pages/index/index (首页)
- pages/list/list (列表)
- pages/detail/detail (详情)
- pages/cart/cart (购物车)
- pages/mine/mine (个人中心)

TabBar：包含 4 个 tab
全局样式：页面背景 #f5f5f5，文字颜色 #333
数据来源：wx.request 请求 https://xxx/api/...
自定义组件：2 个（card、modal）
后端接口：GET /api/plans、GET /api/plans/:id
```

**示例 3 — APP 项目**：

```text
项目类型：APP - uni-app
页面数量：4 个（中等复杂度）

页面：
- pages/index/index (首页)
- pages/course/course (课程列表)
- pages/booking/booking (课程预约)
- pages/mine/mine (个人中心)

TabBar：包含 4 个 tab
全局样式：页面背景 #f5f5f5，主色调 #7c3aed
数据来源：uni.request 请求 https://xxx/api/...
自定义组件：2 个（course-card、tab-bar）
后端接口：GET /api/courses、POST /api/bookings
```

**示例 2 — 网站项目**：

```text
项目类型：网站 - Vue 3 + Vite
页面数量：3 个（简单复杂度）

页面：
- / (Home.vue - 首页)
- /plan/:id (PlanDetail.vue - 详情)
- /about (About.vue - 关于)

路由：Vue Router，3 条路由
全局样式：主色调 #4A90D9
数据来源：fetch 调用 /api/plans、/api/plans/:id
自定义组件：3 个（NavBar、TripCard、MapView）
后端接口：GET /api/plans、GET /api/plans/:id
```

> 此时 Agent 已明确项目类型、平台/架构和复杂度，后续步骤将走对应分支。

---

## 第 2A 步：创建 uni-app 项目骨架（小程序分支）

**适用条件**：第 1 步判断项目类型为「小程序」（任意平台）

**目标**：无论原始小程序是哪个平台，统一生成 uni-app 项目结构，因为 uni-app 支持编译为 H5。

### 提示词

```text
请根据上一步分析的小程序结构，帮我创建一个 uni-app 项目的基础骨架。

原始小程序平台为：[微信/支付宝/百度/抖音/Taro/其他]
页面数量：[X] 个

要求：
1. 生成 pages.json，按照原小程序的页面路由和 tabBar 配置进行设置，tabBar 图标暂时用文字描述（后续我会替换图片）；
2. 生成 App.vue，里面包含 onLaunch 生命周期，并引入原小程序的全局样式；
3. 生成 main.js，挂载 App；
4. manifest.json 使用默认 h5 配置，router mode 设为 hash，publicPath 设为 './'。

请直接给出这 4 个文件的完整代码。
```

### 预期效果

你会得到 `pages.json`、`App.vue`、`main.js`、`manifest.json` 的初始代码，可以直接放入 uni-app 项目的根目录。

> **注意**：
> - 如果原小程序使用了 rpx 单位，uni-app 默认已支持，无需转换
> - 如果原项目已经是 uni-app/Taro 项目，可跳过此步，直接进入第 3A 步修改页面

---

## 第 2B 步：提取网站前端页面（网站分支）

**适用条件**：第 1 步判断项目类型为「网站」（任意架构）

**目标**：从网站项目中提取出纯前端页面文件，去除后端依赖，形成可独立运行的静态项目。

### 提示词

```text
请根据上一步分析的网站项目结构，帮我提取出纯前端页面，形成一个可独立运行的静态项目。

原始网站架构为：[纯静态/Vue 2/Vue 3 + Vue Router/React + React Router/Next.js/Nuxt/Svelte/其他]

要求：
1. 提取所有 HTML、CSS、JS 文件，保持原有目录结构；
2. 如果项目使用了 Vue/React/Svelte 等框架，保留框架代码，确保可以正常构建；
3. 如果项目使用了 Next.js/Nuxt 等服务端框架，提取为纯客户端渲染版本（去除 SSR 相关代码）；
4. 去除所有后端 API 调用（如 fetch/axios 请求），用静态 mock 数据替代；
5. 如果项目有 package.json，保留依赖配置；
6. 如果是纯静态网站（无框架），直接复用原文件即可；
7. 确保本地打开 index.html 或 npm run dev 后可以正常显示页面。

请给出项目文件清单和需要修改的文件内容。
```

### 不同架构的处理策略

| 架构 | 处理方式 |
|------|---------|
| 纯静态 | 直接复用，确保资源用相对路径 |
| Vue + Vite | 保留项目结构，API 改为 mock |
| Vue + Webpack | 保留项目结构，API 改为 mock |
| React + Vite | 保留项目结构，API 改为 mock |
| Next.js | 提取为纯客户端 React + Vite 项目，去除 `getServerSideProps` 等 SSR 方法 |
| Nuxt.js | 提取为纯客户端 Vue + Vite 项目，去除 `asyncData` / `fetch` 等 SSR 方法 |
| SvelteKit | 提取为纯客户端 Svelte + Vite 项目 |

### 预期效果

你会得到一个去除后端依赖的纯前端项目，本地可以直接运行或构建。

---

## 第 2C 步：提取 APP 前端页面（APP 分支）

**适用条件**：第 1 步判断项目类型为「APP」（任意平台/框架）

**目标**：从 APP 项目中提取核心页面和交互，形成可独立运行的 H5 演示项目。

### 提示词

```text
请根据上一步分析的 APP 项目结构，帮我提取核心页面，形成一个可独立运行的 H5 演示项目。

原始 APP 平台/框架为：[原生 Android/原生 iOS/uni-app/Taro/Flutter/React Native/Hybrid/其他]

要求：
1. 如果是 uni-app 或 Taro 项目，保留项目结构，直接配置编译为 H5；
2. 如果是原生 Android/iOS/Flutter/React Native 项目，提取核心页面（首页、列表、详情、个人中心等），用 HTML/CSS/JS 重写；
3. 如果是 Hybrid App，直接提取 WebView 内的 HTML/CSS/JS 文件；
4. 保留底部 TabBar、页面跳转、列表渲染、按钮交互等核心交互效果；
5. 去除所有后端 API 调用和原生能力调用（如摄像头、蓝牙、定位等），用静态 mock 数据替代；
6. 确保页面在浏览器中以 375px 宽度（iPhone 标准宽度）为基准设计，适配移动端；
7. 给出项目文件清单和关键文件代码。
```

### 不同 APP 类型的处理策略

| APP 类型 | 处理方式 | 输出产物 |
|---------|---------|---------|
| uni-app | 保留项目结构，配置 manifest.json 输出 H5 | H5 站点 |
| Taro | 保留项目结构，配置 H5 输出 | H5 站点 |
| 原生 Android | 提取 XML 布局，用 HTML/CSS 重写 | 纯静态 H5 |
| 原生 iOS | 提取 Storyboard/SwiftUI，用 HTML/CSS 重写 | 纯静态 H5 |
| Flutter | 提取 Dart 页面结构，用 HTML/CSS 重写 | 纯静态 H5 |
| React Native | 提取 JSX 组件，用 HTML/CSS 重写 | 纯静态 H5 |
| Hybrid App | 直接复用 WebView 内的 H5 内容 | 纯静态 H5 |

### 预期效果

你会得到一个去除后端依赖和原生能力依赖的纯前端 H5 项目，浏览器打开即可演示 APP 核心页面和交互。

---

## 第 3A 步：逐页面迁移（小程序分支）

**适用条件**：第 1 步判断项目类型为「小程序」（任意平台）

**目标**：将原始小程序页面转换成 uni-app 的 .vue 单文件组件。

**策略**：根据页面数量调整迁移节奏 — 简单项目（1~3 页）可一次性迁移，中等项目（4~8 页）逐页迁移，复杂项目（8 页以上）分批迁移（每次 3~4 页）。

### 提示词（以首页为例）

```text
现在请帮我将小程序的首页（pages/index/index）转换为 uni-app 格式的 index.vue 文件。

原始小程序平台为：[微信/支付宝/百度/抖音/Taro/其他]
原始文件为：
- 模板文件内容如下： [粘贴模板代码]
- JS 文件内容如下： [粘贴 JS 代码]
- 样式文件内容如下： [粘贴样式代码]

转换要求：
1. 使用 Vue 的 template / script / style 三部分结构；
2. 模板语法转换规则：
   - 微信：wx:if → v-if，wx:for → v-for，bindtap → @click
   - 支付宝：a:if → v-if，a:for → v-for，onTap → @click
   - 百度：s-if → v-if，s-for → v-for，bindtap → @click
   - 抖音：tt:if → v-if，tt:for → v-for，bindtap → @click
   - Taro：已是 JSX，需转为 Vue template 语法
3. API 前缀统一转换：wx./my./swan./tt. → uni.
4. JS 中的 Page({}) 转为 export default { data(){}, methods:{}, onLoad(){} } 形式；
5. 数据请求（如果有）暂时用静态 mock 数据替代，写在 data 中；
6. 样式保留 rpx 单位，scoped 属性可选；
7. 如果原页面有 onPullDownRefresh 等页面级事件，请对应转为 uni-app 的生命周期/事件处理。

请给出完整的 index.vue 文件代码。
```

### 各平台模板语法转换速查

| 原平台 | 条件渲染 | 列表渲染 | 事件绑定 | 数据绑定 | 导航 API |
|--------|---------|---------|---------|---------|---------|
| 微信 | `wx:if` | `wx:for` | `bindtap` | `{{}}` | `wx.navigateTo` |
| 支付宝 | `a:if` | `a:for` | `onTap` | `{{}}` | `my.navigateTo` |
| 百度 | `s-if` | `s-for` | `bindtap` | `{{}}` | `swan.navigateTo` |
| 抖音 | `tt:if` | `tt:for` | `bindtap` | `{{}}` | `tt.navigateTo` |
| **uni-app** | **v-if** | **v-for** | **@click** | **{{}}** | **uni.navigateTo** |

### 预期效果

Agent 返回完整的 `.vue` 文件，模板、逻辑、样式一一对应。

---

## 第 3B 步：保留交互效果与简化功能（网站分支）

**适用条件**：第 1 步判断项目类型为「网站」（任意架构）

**目标**：保留网站的核心交互效果，去除复杂功能和后端依赖。

### 提示词

```text
现在请帮我优化提取出的网站前端页面，保留核心交互，简化复杂功能。

原始网站架构为：[纯静态/Vue/React/Next.js/Nuxt/Svelte/其他]

要求：
1. 保留以下交互效果：页面导航、Tab切换、轮播图、表单提交反馈、弹窗/模态框、按钮点击反馈；
2. 去除以下复杂功能：真实支付、第三方登录、后端接口调用、需要服务器的实时数据、WebSocket 连接；
3. 所有 API 请求用静态 mock 数据替代，写在 JS 文件中；
4. 购物车、收藏等用户状态用 localStorage 存储，确保刷新后数据保留；
5. 确保所有页面跳转和交互可以正常工作；
6. 如果是 SSR 框架（Next.js/Nuxt），确保已转为纯客户端渲染。

请给出需要修改的文件和修改内容。
```

### 预期效果

网站保留核心 UI 交互，去除后端依赖，所有功能可在纯前端环境下正常运行。

---

## 第 3C 步：将 APP 页面转换为可展示的 H5（APP 分支）

**适用条件**：第 1 步判断项目类型为「APP」（任意平台/框架）

**目标**：将 APP 页面转换为适合在手机外框中展示的标准 H5 页面，保留核心交互和移动端体验。

### 提示词

```text
现在请帮我把上一步提取的 APP 页面转换为标准 H5 演示项目。

原始 APP 平台/框架为：[uni-app/Taro/原生 Android/原生 iOS/Flutter/React Native/Hybrid/其他]
页面数量：[X] 个

转换要求：
1. 使用 HTML5 + CSS3 + 原生 JavaScript（或 Vue/React，如原项目使用）实现；
2. 页面宽度按 375px 移动端设计，使用 viewport 适配；
3. 保留 APP 底部 TabBar 导航，点击切换页面；
4. 保留列表滚动、卡片点击、表单提交、按钮反馈等交互效果；
5. 页面切换使用淡入淡出或滑动动画，模拟原生 APP 体验；
6. 数据请求全部改为静态 mock 数据；
7. 用户状态（如登录、收藏、购物车）用 localStorage 或 sessionStorage 模拟；
8. 确保所有页面可以放在一个 index.html 中，或按 pages/ 目录组织多页面。

请给出完整的项目文件结构和关键代码。
```

### APP 页面迁移要点

| 原 APP 元素 | H5 对应实现 | 注意事项 |
|------------|------------|---------|
| 底部 TabBar | fixed 定位的 div | 图标可用 emoji 或文字替代 |
| 页面切换 | 显示/隐藏 div 容器 | 用 CSS transition 模拟滑动 |
| 列表组件 | div + CSS flex/grid | 使用 overflow-y: auto 实现滚动 |
| 轮播图 | CSS transform + JS | 可用手势滑动 |
| 弹窗/Toast | fixed 定位 + opacity 动画 | 3 秒自动消失 |
| 原生 API | 移除或用 mock 数据替代 | 如定位、扫码、相机等 |

### 预期效果

所有 APP 页面转换为标准的 H5 页面，在手机外框弹窗中展示时效果接近真实 APP。

---

## 第 4A 步：迁移其他页面并处理跳转（小程序分支）

**适用条件**：第 1 步判断项目类型为「小程序」

重复第 3A 步的提示词，替换对应文件名即可。

**页面数量较多时的策略**：

| 页面数量 | 建议策略 |
|---------|---------|
| 1~3 页 | 一次性全部迁移 |
| 4~8 页 | 逐页迁移，每次 1~2 页 |
| 8 页以上 | 分批迁移，每次 3~4 页，优先迁移核心页面 |

### 额外提示（针对跳转）

```text
在所有页面的跳转方法中，请将原平台导航 API 统一转换为 uni-app 语法：
- wx.navigateTo / my.navigateTo / swan.navigateTo / tt.navigateTo → uni.navigateTo
- wx.switchTab / my.switchTab / swan.switchTab / tt.switchTab → uni.switchTab
- wx.redirectTo / my.redirectTo / swan.redirectTo / tt.redirectTo → uni.redirectTo
- wx.navigateBack / my.navigateBack / swan.navigateBack / tt.navigateBack → uni.navigateBack

并保证路径与原项目一致。
```

### 预期效果

所有核心页面的 `.vue` 文件生成完毕，页面间的跳转、参数传递可以正常工作。

---

## 第 4B 步：配置构建与打包（网站分支）

**适用条件**：第 1 步判断项目类型为「网站」

**目标**：配置项目的构建工具，确保可以打包为可部署的静态文件。

### 提示词

```text
现在请帮我配置项目的构建打包，生成可部署的静态文件。

原始网站架构为：[纯静态/Vue + Vue/React + Vite/Next.js/Nuxt/Svelte/其他]

要求：
1. 根据不同架构配置构建：
   - Vite 项目：配置 base 为 '/仓库名/'
   - Webpack 项目：配置 output.publicPath 为 '/仓库名/'
   - Next.js 项目：配置 basePath 为 '/仓库名/'，output 为 'export'
   - Nuxt 项目：配置 app.baseURL 为 '/仓库名/'
   - 纯静态网站：确保所有资源引用使用相对路径
2. 构建产物应输出到 dist 目录；
3. 确保构建后可以用浏览器直接打开 dist/index.html 查看效果。

仓库名为：[你的仓库名]

请给出构建配置文件和构建命令。
```

### 不同架构的构建配置速查

| 架构 | 配置文件 | 关键配置 | 构建命令 |
|------|---------|---------|---------|
| Vite | `vite.config.js` | `base: '/仓库名/'` | `npm run build` |
| Webpack | `webpack.config.js` | `output.publicPath: '/仓库名/'` | `npm run build` |
| Next.js | `next.config.js` | `basePath: '/仓库名/'`, `output: 'export'` | `npm run build` |
| Nuxt | `nuxt.config.ts` | `app: { baseURL: '/仓库名/' }` | `npm run generate` |
| SvelteKit | `svelte.config.js` | `paths: { base: '/仓库名/' }`, `adapter-static` | `npm run build` |
| 纯静态 | 无 | 资源用相对路径 `./` | 无需构建 |

### 预期效果

项目可以成功构建为静态文件，产物在 `dist` 目录，浏览器可直接打开预览。

---

## 第 4C 步：构建 APP 演示项目（APP 分支）

**适用条件**：第 1 步判断项目类型为「APP」（任意平台/框架）

**目标**：将 H5 项目构建为可部署的静态文件。

### 提示词

```text
现在请帮我配置项目的构建打包，生成可部署的静态文件。

原始 APP 平台/框架为：[uni-app/Taro/原生 Android/原生 iOS/Flutter/React Native/Hybrid/其他]

要求：
1. 如果是 uni-app 项目，配置 manifest.json 中 H5 的 router mode 为 hash，publicPath 为 '/仓库名/'；
2. 如果是 Taro 项目，配置 config/index.js 中 H5 的 publicPath 为 '/仓库名/'；
3. 如果是纯 HTML/CSS/JS 项目，确保资源使用相对路径，无需复杂构建；
4. 如果是 Vite/Webpack 项目，配置 base 为 '/仓库名/'；
5. 构建产物应输出到 dist 或 dist/build/h5 目录；
6. 确保构建后可以用浏览器直接打开查看效果。

仓库名为：[你的仓库名]

请给出构建配置文件和构建命令。
```

### 不同 APP 类型的构建配置速查

| APP 类型 | 配置文件 | 关键配置 | 构建命令 | 产物目录 |
|---------|---------|---------|---------|---------|
| uni-app | `manifest.json` | `h5.publicPath: '/仓库名/'` | `npm run build:h5` | `dist/build/h5` |
| Taro | `config/index.js` | `h5.publicPath: '/仓库名/'` | `npm run build:h5` | `dist` |
| 纯 HTML/CSS/JS | 无 | 资源相对路径 `./` | 无需构建 | 项目根目录 |
| Vite | `vite.config.js` | `base: '/仓库名/'` | `npm run build` | `dist` |
| Webpack | `webpack.config.js` | `output.publicPath: '/仓库名/'` | `npm run build` | `dist` |

### 预期效果

APP 演示项目成功构建为静态文件，可在浏览器中打开预览。

---

## 第 5 步：处理数据层 —— 用本地存储模拟全局状态（共享）

**目标**：用本地存储替代后端接口和全局变量，实现跨页面数据共享和持久化。

### 小程序分支提示词

```text
现在需要实现跨页面数据共享功能。原来页面通过全局变量 globalData 或 API 存储数据，请帮我改为使用 uni.setStorageSync 和 uni.getStorageSync。

具体修改：
1. 在写入数据的页面中，将数据存入本地存储；
2. 在读取数据的页面中，从本地存储读取并显示；
3. 删除和清空操作也要同步更新本地存储。

请给出修改后的相关代码。
```

### APP 分支提示词

```text
现在需要实现 APP 演示项目中的跨页面数据共享功能。

如果原项目使用了 uni-app 的 storage 或全局状态，请改为使用 localStorage 或 uni.setStorageSync（如果仍用 uni-app 编译）。

具体修改：
1. 在写入数据的页面中，将数据存入本地存储；
2. 在读取数据的页面中，从本地存储读取并显示；
3. 删除、清空和更新操作也要同步更新本地存储；
4. 确保刷新页面后数据仍然保留。

请给出修改后的相关代码。
```

### 网站分支提示词

```text
现在需要实现跨页面数据共享功能。原来页面通过后端 API 或全局状态管理存储数据，请帮我改为使用 localStorage。

具体修改：
1. 在写入数据的页面中，将数据存入 localStorage；
2. 在读取数据的页面中，从 localStorage 读取并显示；
3. 删除和清空操作也要同步更新 localStorage。

注意：
- 如果项目使用了 Vuex/Pinia/Redux 等状态管理，保留状态管理框架，但在 store 的 action 中用 localStorage 持久化关键数据；
- 确保刷新页面后数据仍然保留。

请给出修改后的相关代码。
```

### 预期效果

数据能在多个页面间共享，刷新后数据仍然保留，完美模拟了真实交互。

---

## 第 6 步：编译构建并预览（共享）

**目标**：在本地生成可直接在浏览器打开的 Web 版本。

### 小程序分支提示词

```text
我已经将所有页面迁移完成，项目根目录包含 pages.json、App.vue、main.js、manifest.json 以及 pages/ 下的所有 .vue 文件。
现在请给我在命令行中执行编译为 H5 的步骤。
我的项目名为 "[项目名]"。
请使用 yarn 或 npm 进行依赖安装和构建。
```

### APP 分支提示词

```text
我已经完成 APP 演示项目的页面转换和构建配置。
现在请给我在命令行中执行编译/构建的步骤。

我的项目名为 "[项目名]"，APP 类型为 [uni-app/Taro/原生重写/其他]。
请使用 npm 或 yarn 进行依赖安装和构建。
```

### 网站分支提示词

```text
我已经完成前端页面的提取和简化，项目已配置好构建工具。
现在请给我在命令行中执行构建的步骤。
我的项目名为 "[项目名]"，架构为 [Vue + Vite / React + Webpack / Next.js / Nuxt / 其他]。
请使用 yarn 或 npm 进行依赖安装和构建。
```

### 预期效果

Agent 会给出类似如下的命令：

```bash
# 小程序分支
npm install
npm run build:h5
# 产物在 dist/build/h5 目录

# 网站分支（不同架构构建命令不同）
npm install
npm run build        # Vite / Webpack / SvelteKit
npm run generate     # Nuxt
npm run build        # Next.js (output: 'export' 模式)
```

用浏览器打开 `index.html`，即可看到和原项目几乎一样的界面，交互功能全部正常。

---

## 第 7 步：部署到 GitHub Pages（共享）

**目标**：将构建产物部署到 GitHub Pages，生成公网可访问的演示地址。

### 提示词

```text
我的项目已编译完成，产物在 dist/build/h5（小程序/uni-app APP 分支）或 dist（网站/Taro/纯 H5 APP 分支）文件夹。
现在我想把它部署到 GitHub Pages，仓库名为 [你的仓库名]。
请告诉我具体操作步骤，包括：
1. 需要修改的 publicPath / base / basePath 配置（如果必要）；
2. 如何初始化 Git 仓库并推送到 GitHub；
3. 如何配置 GitHub Pages 或 GitHub Actions 自动部署；
4. 最终的公网访问地址是什么。

请给出完整的操作步骤。
```

### 预期效果

Agent 会指导你完成以下操作：

1. **确认路径配置**：已在第 4A/4B 步设置完毕
2. **推送代码**：
   ```bash
   git init
   git add .
   git commit -m "init: 项目演示"
   git remote add origin https://github.com/用户名/仓库名.git
   git push -u origin main
   ```
3. **部署方式**（二选一）：
   - **手动部署**：将构建产物推送到 `gh-pages` 分支
   - **自动部署**：配置 `.github/workflows/deploy.yml`
4. **公网地址**：`https://用户名.github.io/仓库名/`

> 最终你会在任何设备上通过该 URL 访问项目演示效果。

---

## 附录：真实案例演示 —— 旅行规划网站项目

> 以下演示一个真实的网站项目如何按照本手册，从原始代码到最终部署到 GitHub Pages 的完整过程。

### 项目背景

- **项目名称**：旅行规划网站
- **项目类型**：网站 - Vue 3 + Vite
- **页面数量**：3 个（简单复杂度）
- **最终演示地址**：https://suxiaoxin1.github.io/web_domes_2/

---

### 第 1 步：分析项目结构，判断项目类型

**用户输入**（将项目文件结构发给 Agent）：

```text
你是一个前端项目分析与迁移专家。现在我会把我的项目文件结构发给你。
请先阅读所有文件，分析并回答以下内容：

【项目类型判断】（必须首先明确回答）
- 如果项目是小程序 → 回答「小程序」+ 具体平台，后续走 A 分支
- 如果项目是网站   → 回答「网站」+ 具体架构，后续走 B 分支

【项目结构分析】
1. 所有页面路径和对应的文件名；
2. 路由配置；
3. 全局样式文件中的关键样式；
4. 每个页面用到的数据来源；
5. 是否有自定义组件；
6. 是否依赖后端接口；
7. 项目复杂度评估。

项目文件结构如下：
├── index.html
├── package.json
├── vite.config.js
├── src/
│   ├── App.vue
│   ├── main.js
│   ├── router/
│   │   └── index.js
│   ├── views/
│   │   ├── Home.vue
│   │   ├── PlanDetail.vue
│   │   └── About.vue
│   ├── components/
│   │   ├── NavBar.vue
│   │   ├── TripCard.vue
│   │   └── MapView.vue
│   └── assets/
│       └── styles/
│           └── global.css
```

**Agent 回复**：

```text
项目类型：网站 - Vue 3 + Vite（走 B 分支）
页面数量：3 个（简单复杂度）

页面：
- / (Home.vue - 首页，旅行规划列表)
- /plan/:id (PlanDetail.vue - 规划详情页)
- /about (About.vue - 关于页面)

路由配置：Vue Router，3 条路由
全局样式：global.css，主色调 #4A90D9，字体 PingFang SC
数据来源：
  - Home.vue：调用 fetch('/api/plans') 获取旅行规划列表
  - PlanDetail.vue：调用 fetch('/api/plans/:id') 获取详情
  - About.vue：纯静态页面
自定义组件：3 个（NavBar、TripCard、MapView）
后端接口依赖：
  - GET /api/plans — 获取规划列表
  - GET /api/plans/:id — 获取规划详情
```

> Agent 已明确项目类型为「网站 - Vue 3 + Vite」，后续走 B 分支。

---

### 第 2B 步：提取网站前端页面

**用户输入**：

```text
请根据上一步分析的网站项目结构，帮我提取出纯前端页面，形成一个可独立运行的静态项目。

原始网站架构为：Vue 3 + Vite

要求：
1. 提取所有 HTML、CSS、JS 文件，保持原有目录结构；
2. 保留 Vue 3 框架代码，确保可以正常构建；
3. 去除所有后端 API 调用，用静态 mock 数据替代；
4. 保留 package.json 依赖配置；
5. 确保 npm run dev 后可以正常显示页面。

请给出项目文件清单和需要修改的文件内容。
```

**Agent 回复**（关键修改摘要）：

```text
项目文件保持原有 Vue 3 + Vite 结构，主要修改以下文件：

1. 新建 src/mock/plans.js — 静态 mock 数据，替代 /api/plans 接口
2. 修改 src/views/Home.vue — 将 fetch('/api/plans') 改为 import mock 数据
3. 修改 src/views/PlanDetail.vue — 将 fetch('/api/plans/:id') 改为从 mock 数据中按 id 查找
4. 保留 package.json、vite.config.js 等构建配置不变
```

**mock 数据示例**（`src/mock/plans.js`）：

```js
// 旅行规划 mock 数据（替代后端 API）
export const plans = [
  {
    id: 1,
    title: '云南大理三日游',
    description: '苍山洱海，风花雪月',
    days: 3,
    image: '/images/dali.jpg',
    itinerary: [
      { day: 1, title: '抵达大理', activities: '古城漫步、洋人街' },
      { day: 2, title: '环洱海', activities: '双廊古镇、小普陀' },
      { day: 3, title: '苍山索道', activities: '感通寺、清碧溪' }
    ]
  },
  {
    id: 2,
    title: '北京五日游',
    description: '千年古都，文化之旅',
    days: 5,
    image: '/images/beijing.jpg',
    itinerary: [
      { day: 1, title: '天安门广场', activities: '故宫、景山公园' },
      { day: 2, title: '长城', activities: '慕田峪长城' }
    ]
  }
]
```

**Home.vue 修改前后对比**：

```js
// ❌ 修改前：调用后端 API
async mounted() {
  const res = await fetch('/api/plans');
  this.plans = await res.json();
}

// ✅ 修改后：使用 mock 数据
import { plans } from '../mock/plans.js';
mounted() {
  this.plans = plans;
}
```

---

### 第 3B 步：保留交互效果与简化功能

**用户输入**：

```text
现在请帮我优化提取出的网站前端页面，保留核心交互，简化复杂功能。

原始网站架构为：Vue 3 + Vite

要求：
1. 保留以下交互效果：页面导航、Tab切换、轮播图、表单提交反馈、弹窗/模态框、按钮点击反馈；
2. 去除以下复杂功能：真实支付、第三方登录、后端接口调用、需要服务器的实时数据；
3. 所有 API 请求用静态 mock 数据替代；
4. 购物车、收藏等用户状态用 localStorage 存储，确保刷新后数据保留；
5. 确保所有页面跳转和交互可以正常工作。

请给出需要修改的文件和修改内容。
```

**Agent 回复**（关键修改摘要）：

```text
保留的交互：
- Vue Router 页面导航（首页 ↔ 详情页 ↔ 关于页）✅
- TripCard 点击跳转到详情页 ✅
- NavBar 导航栏切换 ✅
- 地图组件交互（缩放、拖动）✅

简化的功能：
- MapView.vue 中原来调用高德地图 API 获取实时路线 → 改为静态标记点展示
- 去除用户登录状态判断，所有页面可直接访问
- 收藏功能改为 localStorage 实现

具体修改：
1. 修改 src/components/MapView.vue — 去除高德 API 路线规划，改为静态标记
2. 修改 src/views/PlanDetail.vue — 收藏按钮改用 localStorage
3. 删除 src/utils/auth.js — 移除登录相关工具函数
```

**收藏功能 localStorage 示例**：

```js
// 收藏/取消收藏旅行规划（使用 localStorage 持久化）
toggleFavorite(planId) {
  let favorites = JSON.parse(localStorage.getItem('favorites') || '[]');
  const index = favorites.indexOf(planId);
  if (index > -1) {
    favorites.splice(index, 1);
  } else {
    favorites.push(planId);
  }
  localStorage.setItem('favorites', JSON.stringify(favorites));
  this.isFavorited = favorites.includes(planId);
}
```

---

### 第 4B 步：配置构建与打包

**用户输入**：

```text
现在请帮我配置项目的构建打包，生成可部署的静态文件。

原始网站架构为：Vue 3 + Vite
仓库名为 web_domes_2

请给出构建配置文件和构建命令。
```

**Agent 回复**：

```text
修改 vite.config.js，设置 base 为仓库名：

// vite.config.js
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  base: '/web_domes_2/',  // GitHub Pages 部署路径
  build: {
    outDir: 'dist'
  }
})

构建命令：
npm install
npm run build

产物在 dist 目录，可直接部署到 GitHub Pages。
```

---

### 第 5 步：处理数据层

本案例中已在第 2B 步和第 3B 步完成：
- API 请求 → mock 数据
- 收藏状态 → localStorage

无需额外修改。

---

### 第 6 步：编译构建并预览

**用户输入**：

```text
我已经完成前端页面的提取和简化，项目已配置好构建工具。
现在请给我在命令行中执行构建的步骤。
我的项目名为 "web_domes_2"，架构为 Vue 3 + Vite。
请使用 npm 进行依赖安装和构建。
```

**Agent 回复**：

```bash
cd web_domes_2
npm install
npm run build
# 产物在 dist 目录
# 本地预览可用：npx serve dist
```

**本地验证**：

```bash
npx serve dist
# 浏览器打开 http://localhost:3000/web_domes_2/
# 确认：页面导航正常、旅行规划列表显示、详情页可打开、收藏功能正常
```

---

### 第 7 步：部署到 GitHub Pages

**用户输入**：

```text
我的项目已编译完成，产物在 dist 文件夹。
现在我想把它部署到 GitHub Pages，仓库名为 web_domes_2。
请告诉我具体操作步骤。
```

**Agent 回复**：

```text
步骤如下：

1. 确认 vite.config.js 中 base 已设置为 '/web_domes_2/'（第4B步已配置）

2. 初始化 Git 仓库并推送：
   git init
   git add .
   git commit -m "init: 旅行规划网站演示"
   git remote add origin https://github.com/suxiaoxin1/web_domes_2.git
   git push -u origin main

3. 配置 GitHub Pages：
   - 方式一（推荐）：在仓库 Settings → Pages → Source 选择 "GitHub Actions"
   - 方式二：手动将 dist 目录推送到 gh-pages 分支

4. 配置 GitHub Actions 自动部署（.github/workflows/deploy.yml）：

   name: Deploy to GitHub Pages
   on:
     push:
       branches: [main]
   jobs:
     deploy:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with:
             node-version: 18
         - run: npm install
         - run: npm run build
         - uses: peaceiris/actions-gh-pages@v3
           with:
             github_token: ${{ secrets.GITHUB_TOKEN }}
             publish_dir: ./dist

5. 最终公网地址：
   https://suxiaoxin1.github.io/web_domes_2/
```

---

### 案例总结

| 步骤 | 操作 | 耗时 |
|------|------|------|
| 第 1 步 | 判断项目类型为「网站 - Vue 3 + Vite」，走 B 分支 | 1 轮对话 |
| 第 2B 步 | 去除后端 API，用 mock 数据替代 | 1 轮对话 |
| 第 3B 步 | 保留交互、简化功能、localStorage 替代 | 1 轮对话 |
| 第 4B 步 | 配置 Vite base 路径 | 1 轮对话 |
| 第 5 步 | 已在前序步骤完成 | — |
| 第 6 步 | npm install && npm run build | 1 轮对话 |
| 第 7 步 | 推送 GitHub + 配置 Pages | 1 轮对话 |

> 整个流程约 **5~6 轮对话**，Agent 即可完成从原始项目到公网演示地址的全部工作。

## 附录：真实案例演示 —— 健身运动 APP 项目

> 以下演示一个真实的 APP 项目如何按照本手册，从原始代码到最终部署到 GitHub Pages 的完整过程。

### 项目背景

- **项目名称**：健身运动 APP
- **项目类型**：APP - uni-app（基于 Vue 2 语法）
- **页面数量**：4 个（中等复杂度）
- **最终演示地址**：https://suxiaoxin1.github.io/app_dome_1_fitness-app/
- **GitHub 仓库**：https://github.com/Suxiaoxin1/app_dome_1_fitness-app

### 第 1 步：分析项目结构，判断项目类型

**用户输入**（将项目文件结构发给 Agent）：

```text
你是一个前端项目分析与迁移专家。现在我会把我的项目文件结构发给你。
请先阅读所有文件，分析并回答：

【项目类型判断】（必须首先明确回答）
- 如果项目是小程序 → 回答「小程序」+ 具体平台，后续走 A 分支
- 如果项目是 APP   → 回答「APP」+ 具体平台/框架，后续走 C 分支
- 如果项目是网站   → 回答「网站」+ 具体架构，后续走 B 分支

项目文件结构如下：
├── pages/
│   ├── index/index.vue
│   ├── course/course.vue
│   ├── booking/booking.vue
│   └── mine/mine.vue
├── App.vue
├── main.js
├── manifest.json
├── pages.json
└── package.json
```

**Agent 回复**：

```text
项目类型：APP - uni-app（走 C 分支）
页面数量：4 个（中等复杂度）

页面：
- pages/index/index (首页，训练概览)
- pages/course/course (课程列表)
- pages/booking/booking (课程预约)
- pages/mine/mine (个人中心)

TabBar：包含 4 个 tab
全局样式：页面背景 #f5f5f5，主色调 #7c3aed
数据来源：静态 mock 数据
自定义组件：无
后端接口：无
```

### 第 2C 步：提取 APP 前端页面

**用户输入**：

```text
请根据上一步分析的 APP 项目结构，帮我提取核心页面，形成一个可独立运行的 H5 演示项目。

原始 APP 平台/框架为：uni-app

要求：
1. 保留项目结构，直接配置编译为 H5；
2. 保留底部 TabBar 和 4 个页面切换；
3. 去除所有后端 API 调用，用静态 mock 数据替代；
4. 确保页面以 375px 宽度为基准设计；
5. 给出项目文件清单和关键文件代码。
```

**Agent 回复**（关键修改摘要）：

```text
项目保留 uni-app 结构，主要配置如下：

1. 修改 manifest.json，设置 H5 的 publicPath 为 './'（本地预览）
2. 修改 pages.json，配置 4 个 TabBar 页面
3. 保留 pages/index/index.vue、pages/course/course.vue、pages/booking/booking.vue、pages/mine/mine.vue
4. 所有数据使用 static/mock 目录下的静态数据
5. 无需后端接口
```

### 第 3C 步：将 APP 页面转换为可展示的 H5

**用户输入**：

```text
现在请帮我把上一步提取的 APP 页面转换为标准 H5 演示项目，适合在手机外框中展示。

原始 APP 平台/框架为：uni-app
页面数量：4 个

转换要求：
1. 保留 uni-app 项目结构，但输出为 H5；
2. 页面宽度按 375px 移动端设计；
3. 保留底部 TabBar 导航；
4. 保留列表滚动、卡片点击、按钮反馈等交互；
5. 数据请求全部改为静态 mock 数据；
6. 用户状态用 localStorage 或 uni.setStorageSync 模拟。

请给出完整项目结构和关键代码。
```

**Agent 回复**：

```text
项目结构：
├── pages/
│   ├── index/index.vue
│   ├── course/course.vue
│   ├── booking/booking.vue
│   └── mine/mine.vue
├── App.vue
├── main.js
├── manifest.json
├── pages.json
└── package.json

关键保留：
- 底部 TabBar 4 个 tab：首页、课程、预约、我的
- 深色主题 + 紫色渐变主色调
- 卡片列表、课程详情、预约表单、个人数据展示
- 所有数据均为 static/mock 下的静态数据
```

### 第 4C 步：构建 APP 演示项目

**用户输入**：

```text
现在请帮我配置项目的构建打包，生成可部署的静态文件。

原始 APP 平台/框架为：uni-app
仓库名为 app_dome_1_fitness-app

请给出构建配置文件和构建命令。
```

**Agent 回复**：

```text
// manifest.json（H5 配置）
"h5": {
  "title": "健身运动 APP",
  "router": {
    "mode": "hash"
  },
  "publicPath": "/app_dome_1_fitness-app/"
}

构建命令：
npm install
npm run build:h5

产物在 dist/build/h5 目录
```

### 第 5 步：处理数据层

本案例中使用的是静态 mock 数据，无需 localStorage 持久化。购物车、预约记录等状态用本地数组模拟即可。

### 第 6 步：编译构建并预览

**用户输入**：

```text
我已经完成 APP 演示项目的页面转换和构建配置。
现在请给我在命令行中执行编译/构建的步骤。
我的项目名为 "app_dome_1_fitness-app"，APP 类型为 uni-app。
请使用 npm 进行依赖安装和构建。
```

**Agent 回复**：

```bash
cd app_dome_1_fitness-app
npm install
npm run build:h5
# 产物在 dist/build/h5 目录
```

### 第 7 步：部署到 GitHub Pages

**用户输入**：

```text
我的项目已编译完成，产物在 dist/build/h5 文件夹。
现在我想把它部署到 GitHub Pages，仓库名为 app_dome_1_fitness-app。
请告诉我具体操作步骤。
```

**Agent 回复**：

```text
步骤如下：

1. 确认 manifest.json 中 H5 的 publicPath 已设置为 '/app_dome_1_fitness-app/'

2. 初始化 Git 仓库并推送：
   git init
   git add .
   git commit -m "init: 健身运动 APP 演示"
   git remote add origin https://github.com/Suxiaoxin1/app_dome_1_fitness-app.git
   git push -u origin main

3. 配置 GitHub Pages：
   - 在仓库 Settings → Pages → Source 选择 "main" 分支，目录选 "/ (root)"
   - 等待 1-2 分钟部署完成

4. 最终公网地址：
   https://suxiaoxin1.github.io/app_dome_1_fitness-app/

GitHub 仓库地址：
https://github.com/Suxiaoxin1/app_dome_1_fitness-app
```

### 案例总结

| 步骤 | 操作 | 耗时 |
|------|------|------|
| 第 1 步 | 判断项目类型为「APP - uni-app」，走 C 分支 | 1 轮对话 |
| 第 2C 步 | 保留 uni-app 结构，提取核心页面 | 1 轮对话 |
| 第 3C 步 | 保留 TabBar 和页面切换，静态 mock 数据 | 1 轮对话 |
| 第 4C 步 | 配置 manifest.json H5 的 publicPath | 1 轮对话 |
| 第 5 步 | 静态数据，无需额外处理 | — |
| 第 6 步 | npm install && npm run build:h5 | 1 轮对话 |
| 第 7 步 | 推送 GitHub + 配置 Pages | 1 轮对话 |

> 整个流程约 **5~6 轮对话**，Agent 即可完成从原始 APP 项目到公网演示地址的全部工作。
