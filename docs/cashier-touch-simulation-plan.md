# Borneo Jasa POS — 15.6" 纯触屏收银员仿真测试与防呆改造规范

> [!IMPORTANT]
> 本文档基于现场真实硬件参数（**15.6" FHD 1920×1080 @ 60Hz, 250 nits, 全程纯触摸屏**）与当前代码库实现，对“无科技背景的五金店老收银员能否独立完成收银”进行逐行代码审计，并定义 **5 条黄金路径仿真测试规范** 与 **必改防呆清单**。

---

## 1. 硬件与人体工学物理基线（Hardware & Ergonomics Baseline）

| 维度 | 现场硬件参数 | 物理换算与工程约束 |
| :--- | :--- | :--- |
| **物理尺寸与分辨率** | 15.6" (345.4mm × 194.3mm), `1920 × 1080` | 像素密度 **141.2 PPI**，即 **`1 mm ≈ 5.56 px`** |
| **老员工手指触控靶心** | 粗手指 / 带灰尘 / 偶尔戴手套 | 最小安全触控热区 **`56px × 56px` (10.1mm)**；高频主按钮需 **`64px ~ 76px` (11.5mm ~ 13.7mm)** |
| **输入外设** | **全程纯触摸屏（无物理键盘、无鼠标滚轮）** | 1. 严禁依赖物理键盘快捷键（`Enter`/`Esc`/`Backspace`）作为唯一通路<br>2. 严禁出现“主操作按钮被挤出 `1080px` 高度视口、需要手指搓动隐藏滚动条才能看见”的布局 |
| **屏幕亮度与对比度** | 250 nits (五金店半开放强光环境偏暗) | 禁用态（`:disabled`）与激活态必须有高对比度色差，不能仅靠微弱浅灰边框区分 |

---

## 2. 现有代码逐行审计：老收银员会卡死的 7 个真实陷阱

在写测试之前，必须先直面现有代码里已经存在的硬伤（非猜测，均为代码实锤）：

### 陷阱 1：`PayDialog` 勾选送货单（DO）后，结账按钮直接被挤出 1080p 屏幕底部
- **代码位置**：`apps/pos/src/components/PayDialog.vue` (L272-L645)
- **实测高度账**：
  - 弹窗最大高度为 `max-h-[94vh]`（在 `1080px` 高度下为 **`1015px`**）。
  - 当收银员切到 `Contractor` 并勾选 `Step 2: Issue DO`（第 573 行）时，内部垂直堆叠了：
    1. Header (`88px`)
    2. Walk-in / Contractor 切换栏 (`64px`)
    3. 金额与抹零栏 (`88px`)
    4. Step 1 选择/搜索承包商列表 (`~260px`)
    5. Step 2 送货单表单（工地地址 + 车牌/司机/PO + 打印价格勾选，`~240px`）
    6. 订单备注栏 (`82px`)
    7. Step 3 支付方式（`Credit` 大按钮 `72px` + 4 个其他支付按钮 `60px`，`~170px`）
    8. 外加 6 处 `gap-18px` 与内边距（`~160px`）
  - **总高度达到 `~1,152px` > `1,015px`**！
- **灾难后果**：老收银员勾选完 `Issue DO` 填好车牌后，**最底部的橙色 `Credit`（挂账）按钮和 `Cash/Card/QR/Bank` 按钮全部掉出可视区域下方**。老员工没有鼠标滚轮，在触摸屏上看到下面一片空白，会直接以为“选了送货单就不能结账/系统卡死了”。

### 陷阱 2：称重/量尺商品点“关闭（Close）”后，商品依然偷偷留在购物车里
- **代码位置**：`apps/pos/src/views/TillView.vue` (L143-L178)
- **代码逻辑**：
  ```ts
  function addItem(item: Parameters<typeof cart.add>[0]): void {
    cart.add(item); // 先把 1 kg / 1 ft 塞进购物车！
    if (shouldAutoTriggerNumpad(item.unit)) {
      if (cart.activeUid != null) openNumpad(cart.activeUid, "qty");
    }
  }
  function closeNumpad(): void {
    dropEmptyCustomLine(numpadUid.value); // 只清理单价为 0 的 Lain-lain，不清理刚加进来的称重商品！
    numpadUid.value = null;
  }
  ```
- **灾难后果**：收银员误触了“铁钉 (kg)”或“PVC管 (ft)”，瞬间跳出 `NumpadDialog`。老员工吓了一跳，赶紧按右上角的 `Close`（或点黑色背景遮罩）想取消。弹窗关掉了，**但购物车里却悄无声息多了一行默认的 `1 kg` 铁钉**！老员工根本没注意，直接多收客户钱。

### 陷阱 3：散客现金找零（Tender）没有自定义输入，且“钱没收够”居然允许直接结账
- **代码位置**：`apps/pos/src/components/PayDialog.vue` (L214-L231, L408-L456)
- **两处致命缺陷**：
  1. **无法输入任意实收现金**：界面上只有 `[Exact]`, `[RM 10]`, `[RM 20]`, `[RM 50]`, `[RM 100]` 五个死按钮（第 420-437 行）。如果账单是 `RM 24.00`，客户给了一张 `RM 20` + 一张 `RM 10`（共 `RM 30`），或者账单是 `RM 135.00`，客户给了 `RM 150.00`，**收银员在屏幕上根本没有地方输入 `30` 或 `150` 来算找零！**
  2. **实收金额不足（Short）时不拦截结账**：当账单为 `RM 65.00`，收银员误按了 `RM 50`，屏幕上虽然显示红字 `Short: RM 15.00`（第 415 行），但底部的绿色 `Cash` 大按钮**没有任何 `:disabled` 保护，点击后照样直接按收齐结账出单**！

### 陷阱 4：新建承包商（Ad-hoc Contractor）交互断层
- **代码位置**：`apps/pos/src/components/PayDialog.vue` (L509-L543)
- **代码逻辑**：
  - 当已有承包商列表时，点击右上角 `New` 按钮（`showAdhocForm = !showAdhocForm`），列表瞬间消失，只剩一个孤零零的 `Name` 输入框，且按钮文字变成了令人费解的 `Contractors`（没有任何“返回列表”或“确认新客户”的语义）。

### 陷阱 5：全屏软键盘 `KeyboardDialog` 默认小写且无自动大写辅助
- **代码位置**：`apps/pos/src/components/KeyboardDialog.vue` (L30-L60)
- **问题**：打开软键盘输入客户名（如 `Ah Seng`）或车牌号（如 `SAA 8899`）时，`caps` 默认 `false`（全小写 `q w e r t y`）。老收银员不理解电脑的 `Caps` 锁定逻辑，打出来的车牌和人名全是小写，且软键盘右上角没有统一的 `Close` 按钮。

### 陷阱 6：Electron 窗口在开发/未打包验证时固定 `1280×800`
- **代码位置**：`apps/pos/electron/main.ts` (L290-L296)
- **问题**：`width: 1280, height: 800, kiosk: app.isPackaged`。在 `1920×1080` 触屏上，如果未处于打包 kiosk 模式或环境变量未指定，窗口只有 `1280×800`；且 `main.ts` 的 `dbPath` 硬编码在 `app.getPath("userData")`，缺少通过环境变量（如 `BJ_POS_DB_PATH`）显式指定临时 SQLite 文件的钩子。

### 陷阱 7：违反 `AGENTS.md` 领域边界（UI 组件直连数据库）
- **代码位置**：`apps/pos/src/views/TillView.vue` (L219-L247)
- **问题**：`confirm()` 方法在 Vue 组件内部直接调用 `getRepo()`、`createContractor()`、`updateContractor()`，违反了 `AGENTS.md` 中 *"Never allow UI components or Pinia stores to handle database persistence or transactional business logic"* 的铁律。

---

## 3. 五位“零科技基础”收银员的黄金路径仿真规范（5 Golden Paths）

我们将模拟 5 位典型的马来西亚五金店老员工，在 **`1920 × 1080` 纯触屏视口** 下操作。每条路径不仅验证数据库落盘结果（SQLite 真实表记录），还强制执行 **3 项触屏人体工学断言（Touch Ergonomics Assertions）**：

1. **`assertTouchTarget(el)`**：被点击元素的渲染尺寸必须满足 `height >= 48px`（核心主按钮 `>= 56px`），且 `disabled` 状态不能被强行点击。
2. **`assertInViewport1080p(el)`**：关键操作按钮必须在 `1920×1080` 视口内直接可见，或固定在底部 Footer，无需复杂嵌套滚动即可触达。
3. **`assertPureTouchFlow()`**：全程只允许触发 Touch/Click 事件与软键盘/数字盘点击，严禁在测试中直接向 `<input>` 注入 `.value` 或发送物理键盘事件。

### 路径 1：老张（62 岁，散客整数件购买 + 议价抹零 + 现金找零）
- **人物画像**：只会认大字，不懂电脑，客人买 3 包水泥（比如 RM 24.00/包，共 RM 72.00），客人讲价抹零到 RM 70.00，递过来一张 RM 100 钞票。
- **纯触屏动作流**：
  1. 在左侧分类点击 `Cement & Brick`，点击水泥卡片 1 次（加入购物车，数量 `1`）。
  2. 在购物车行点击 `+` 按钮 2 次（验证 `+` 按钮 `56px × 56px`），数量变为 `3`，总额 `RM 72.00`。
  3. 点击右下角绿色大按钮 `Pay (RM 72.00)`（高 `68px`）。
  4. 在 `PayDialog` 点击 `Round-off Price`（抹零按钮），在弹出的数字盘按 `7` `0` -> 点 `OK`，验证应付总额变为 `RM 70.00` 且显示折扣 `-RM 2.00`。
  5. 在实收现金栏点击 `RM 100` 按钮，验证屏幕醒目显示绿色找零 `Change: RM 30.00`。
  6. 点击绿色 `Cash` 大按钮（高 `76px`）完成结账。
- **验证标准**：
  - 购物车清空，弹出 `Change RM 30.00` 提示，`Reprint` 按钮出现。
  - SQLite `orders` 表生成 `A-0001` 订单，`total_cents = 7000`，`discount_cents = 200`。

### 路径 2：陈阿姨（58 岁，称重五金 + 误触弹窗自救 + 按金额反算重量）
- **人物画像**：害怕突然跳出来的弹窗。先不小心点错了一个称重商品想取消；接着客人说“我要买 2.5 公斤 2寸铁钉”，第二个客人说“给我称 RM 15 块钱的铁钉”。
- **纯触屏动作流**：
  1. **误触自救测试**：点击一个称重商品 -> 自动弹出 `NumpadDialog` -> 陈阿姨立即点击右上角 `Close` -> **断言：购物车必须保持为空（不能残留默认的 1 kg 商品！）**。
  2. **正常称重输入**：再次点击 `Common Wire Nails 2"` (kg) -> 自动弹出 `NumpadDialog` -> 依次点击九宫格 `2` `.` `5` -> 点击绿色 `OK`（高 `128px`） -> 购物车显示 `2.5 kg`。
  3. **按预算反算（Budget Mode）**：点击购物车中的数量或新称重商品 -> 弹出 `NumpadDialog` -> 点击顶部 `By RM Budget` 标签 -> 点击快捷预设 `RM 10` 或按 `1` `5` -> 屏幕实时算出对应 `kg` 数 -> 点击 `OK`。
  4. 点击 `Pay` -> 点击 `Cash` 结账。
- **验证标准**：
  - 首次误触关闭后 `cart.lines.length === 0`。
  - 订单明细中 `qty_milli` 精确等于对应千分位重量，金额分毫不差。

### 路径 3：老李（55 岁，多规格建材挑选 + 快捷长度预设 + 阶梯价触发）
- **人物画像**：老花眼，客人要买某种多规格管材/板材，还要买大数量触发批发阶梯价。
- **纯触屏动作流**：
  1. 点击左侧分类 -> 点击多规格商品组卡片 -> 弹出 `SpecPickerDialog`。
  2. 验证规格卡片最小高度 `112px`，点击目标规格。
  3. `SpecPickerDialog` 自动关闭并无缝弹出 `NumpadDialog`（单位 `ft` 或 `m`）。
  4. 老李直接点击 `Quick Length` 预设按钮或输入数量触发阶梯价 -> 点击 `OK`。
  5. 验证购物车行自动触发批发阶梯价（单价降低，显示原价划线与折扣）。
  6. 点击 `Pay` -> 点击 `QR` 结账。
- **验证标准**：
  - 连环弹窗（`SpecPickerDialog` -> `NumpadDialog`）无焦点死锁或遮罩残留。
  - SQLite 落盘单价为阶梯批发价。

### 路径 4：老王（60 岁，大客户装车中途挂单 Park + 散客插队 + 取回挂单 Recall）
- **人物画像**：正在给一位买了一堆木板和铁管的客户算账，客户突然说“等一下我再去拿两把锤子”，后面排队的散客拿着一包水泥急着付钱。
- **纯触屏动作流**：
  1. 购物车里已有 2 样商品 -> 老王点击底部 `Hold` 按钮（高 `68px`）一键挂单。
  2. 购物车立即清空，顶部 `Held (1)` 变成醒目的琥珀色高亮。
  3. 老王给插队的散客点选 1 包水泥 -> `Pay` -> `Cash` 结完 `A-0001`。
  4. 老王点击空购物车中央或顶部的 `Held (1)` 按钮 -> 弹出 `HoldOrdersDialog`。
  5. 点击挂单卡片右下角的 `Resume` 按钮（高 `56px`） -> 原先的 2 样商品完整回到购物车。
  6. 再加 1 件商品 -> `Pay` -> `Cash` 结完 `A-0002`。
- **验证标准**：
  - 挂单与取回全过程无需打字输入标签即可工作；两笔订单 `A-0001` 与 `A-0002` 独立落盘且互不串单。

### 路径 5：老陈（59 岁，熟客建筑商挂账 Credit + 新建/选择客户 + 开具送货单 DO）
- **人物画像**：建筑商老板来拉货，要求记账（Hutang / Credit）并打一张送货单（DO）给罗里司机带去工地。
- **纯触屏动作流**：
  1. 添加水泥与钢筋入购物车 -> 点击 `Pay`。
  2. 在 `PayDialog` 顶部点击 `Contractor / DO` 大按钮（高 `64px`）。
  3. 在 `Step 1` 列表中直接点击已有建筑商（或点击 `New` -> 点开软键盘 `KeyboardDialog` 敲入名字 -> 点 `OK`）。
  4. 在 `Step 2` 点击勾选 `Issue Delivery Order (DO)` -> 点击 `Lorry no.` 唤起软键盘输入车牌 -> 点击 `OK`。
  5. **关键视口断言**：即使展开了 `Issue DO`，`Step 3` 的橙色 `Credit` 挂账大按钮依然在 `1080p` 屏幕内可见（固定在弹窗底部 Footer，绝不被挤没）！
  6. 点击橙色 `Credit` 按钮完成挂账结账。
- **验证标准**：
  - SQLite 生成 `B-0001` 挂账单与 `DO-0001` 送货单号，车牌号与承包商 ID 正确持久化，同时触发收据与 DO 打印回调。

---

## 4. 待执行改动清单（经确认后严格按此修改）

### A. 必改 UI 防呆与架构修复（4 项精准手术）
1. **修复陷阱 1（`PayDialog.vue` 底部支付按钮被挤出屏幕）**：
   - 将支付方式按钮区（Walk-in 的 `Cash/Card/QR/Bank` 与 Contractor 的 `Credit + Cash/Card/QR/Bank`）提取到弹窗底部的固定 `footer`（`flex-none border-t`），保证无论是否展开 `Issue DO`，**结账按钮永远 100% 固定在屏幕底部可见，绝不需要老员工去滚屏找结账键**。
2. **修复陷阱 2（`TillView.vue` 称重商品首次弹窗点 Close 残留 `1 kg`）**：
   - 记录“首次添加自动弹出 Numpad”的状态（`pendingNewLineUid`）。如果收银员在首次自动弹出的 `NumpadDialog` 上没有点 `OK`，而是直接点了 `Close` 或遮罩层取消，**自动从购物车移除该行**，符合老人“点叉号 = 不要了”的直觉。
3. **修复陷阱 3（`PayDialog.vue` 实收现金找零防呆与自定义输入）**：
   - 增加一个 `Custom`（自定义实收金额）触控按钮，支持老员工输入 `RM 30`、`RM 150` 等任意实收面额计算找零。
   - 当收银员明确输入了 `tenderCents > 0` 且 `tenderCents < totalCents`（即钱没收够，处于 `Short` 状态）时，**禁用 `Cash` 按钮**，防止老员工误点直接把没收够钱的单子结掉。
4. **修复陷阱 6 & 7（`electron/main.ts` 1080p 视口/环境变量钩子 & 领域边界清理）**：
   - 在 `electron/main.ts` 支持 `BJ_POS_DB_PATH` 环境变量覆盖临时 SQLite 路径，并将默认窗口尺寸对齐 `1920×1080`。
   - 将 `TillView.vue` `confirm()` 里的承包商 upsert 逻辑下沉到 `@yf/data` / repo 层，遵守 `AGENTS.md` 规范。

### B. 落地 5 条收银员黄金路径自动化测试套件
1. 新增 `apps/pos/e2e/cashier-golden-paths.test.ts`：
   - 挂载完整的收银台视图（`TillView` + 所有真实子弹窗 + 真实 Pinia + 绑定临时 SQLite 数据库的 `SqlPosRepo`），完整跑通上述 **老张、陈阿姨、老李、老王、老陈** 5 条纯触屏点击流与人体工学尺寸断言。
2. 新增 `apps/pos/e2e/electron-playwright.spec.ts`：
   - 提供原生 Playwright `_electron.launch()` 脚本（绑定 `1920×1080` 视口与临时 SQLite 目录），支持在桌面环境直接拉起真实 Electron 窗口回放这 5 条路径。
