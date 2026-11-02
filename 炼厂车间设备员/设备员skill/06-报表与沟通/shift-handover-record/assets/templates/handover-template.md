# {{workshop}} 设备员{{type}}记录（{{shift}}）

> 交接以双方现场确认签字为准，本记录为辅助整理。本记录为车间设备员的工作交接（{{type}}），不是操作班组交接班。

## 一、交接信息

| 项目 | 内容 |
|---|---|
| 车间 | {{workshop}} |
| 交接类型 | {{type}} |
| 值次 / 说明 | {{shift}} |
| 交接时间 | {{handoverAt}}（北京时间，原始入参 {{handoverIso}}） |
| 交接人 | {{by}} |
| 接手人 | {{to}} |
| 数据来源 | {{sources}} |
| 生成时间 | {{generatedAt}}（北京时间） |

## 二、设备状态变化

{{table:statusChanges}}

## 三、异常与处理

{{table:abnormalHandled}}

## 四、在修设备状态

{{table:inRepair}}

## 五、未完成事项（逐条交接，不得省略）

{{table:pending}}

### 其中：上次交接结转项

{{table:carriedOver}}

> 【注意】结转项保留原始来源交接与原始要求完成时间，未作延期处理；是否调整期限由交接双方现场确认。

## 六、需重点关注事项

{{table:focusItems}}

## 七、未判定事项（需交接双方明确）

{{table:undetermined}}

{{table:statusUndetermined}}

> 以上事项既未按已完成处理，也未按未完成处理，一律随本次交接，由交接双方现场明确。

## 八、交接说明

<!-- ANALYSIS_START -->
{{analysis}}
<!-- ANALYSIS_END -->

## 九、交接签字

| 角色 | 姓名 | 签字 | 时间 |
|---|---|---|---|
| 交接人 | {{by}} |  | {{handoverAt}} |
| 接手人 | {{to}} |  | {{handoverAt}} |

**交接以双方现场确认签字为准，本记录为辅助整理。**

## 附：数据提示

{{warnings}}
