# 回归用例命令（date=2026-11-30, seed=1）

> 命令在技能目录 `设备员skill/04-台账档案与资料管理/moc-change-assistant/` 下运行，`$CASE` 指本技能的演示目录：`CASE=../../../演示case/04-台账档案与资料管理/moc-change-assistant`。

由 make-sample.js 生成，供人工回归；断言见 scripts/selftest.js。

## 1. RN1 同类替换（不属于变更）

```bash
node scripts/moc.js --tag P-2101A --before "316L 材质 DA65-50×6 机械密封 A厂" --after "316L 材质 DA65-50×6 同型号同厂家机械密封" --reason "密封到期更换" --same-model-material 是 --category 备件代用 --out <输出目录>
```

## 2. R1 材质降级（承压设备，附三项法定手续）

```bash
node scripts/moc.js --tag E-2201 --before "管束材质 316L" --after "管束材质 碳钢 Q345R" --reason "降本" --category 材质 --ledger $CASE/sample-equip-ledger.xlsx --out <输出目录>
```

## 3. R3 结构改动（压力容器）

```bash
node scripts/moc.js --tag V-2301 --before "筒体无取样口，DN1600" --after "筒体下部新增 DN25 取样管口一个" --reason "增加采样点" --ledger $CASE/sample-equip-ledger.xlsx --out <输出目录>
```

## 4. R4 工艺超设计（由工艺专业提报）

```bash
node scripts/moc.js --tag C-2401 --before "操作压力 0.6 MPa" --after "操作压力 0.95 MPa" --reason "提量" --exceeds-design 是 --out <输出目录>
```

## 5. R5 联锁定值（由仪表专业提报）

```bash
node scripts/moc.js --tag P-2103A --before "低流量联锁值 12 m3/h" --after "低流量联锁值 8 m3/h" --reason "误停车频繁" --out <输出目录>
```

## 6. R6 同规格不同厂家代用（待厂内评审）

```bash
node scripts/moc.js --tag P-2101A --before "机封 316L 型号 5610 A厂" --after "机封 316L 型号 5610 B厂 同规格" --reason "国产替代" --category 备件代用 --out <输出目录>
```

## 7. R3+R7 临时结构改动

```bash
node scripts/moc.js --tag T-2501 --before "冷却水线 DN150 正常投用" --after "临时加装 DN50 跨线，压力 0.4 MPa" --temporary --until 2026-11-30 --special 否 --out <输出目录>
```

## 8. U1 描述笼统 / 只给位号

```bash
node scripts/moc.js --tag P-2101A --before "换个泵" --after "换成 P-2101B" --reason "坏了" --out <输出目录>
```
