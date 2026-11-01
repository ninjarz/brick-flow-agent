import type { MeshTriangle } from './structuralVoxelizer'

export type LDrawFixedColorLayer = { color: number; hex: string; opacity: number; triangleIndices: number[] }

export type LDrawGeneratedVisualChunk = {
  getLDrawGeneratedPrintLayers: (partNumber: string) => LDrawFixedColorLayer[] | undefined
  getLDrawGeneratedVisualTriangles: (partNumber: string) => MeshTriangle[] | undefined
}

const loadVisualChunk0 = () => import('./ldrawGeneratedVisualChunks/chunk-00')
const loadVisualChunk1 = () => import('./ldrawGeneratedVisualChunks/chunk-01')
const loadVisualChunk2 = () => import('./ldrawGeneratedVisualChunks/chunk-02')
const loadVisualChunk3 = () => import('./ldrawGeneratedVisualChunks/chunk-03')
const loadVisualChunk4 = () => import('./ldrawGeneratedVisualChunks/chunk-04')
const loadVisualChunk5 = () => import('./ldrawGeneratedVisualChunks/chunk-05')
const loadVisualChunk6 = () => import('./ldrawGeneratedVisualChunks/chunk-06')
const loadVisualChunk7 = () => import('./ldrawGeneratedVisualChunks/chunk-07')
const loadVisualChunk8 = () => import('./ldrawGeneratedVisualChunks/chunk-08')
const loadVisualChunk9 = () => import('./ldrawGeneratedVisualChunks/chunk-09')
const loadVisualChunk10 = () => import('./ldrawGeneratedVisualChunks/chunk-10')
const loadVisualChunk11 = () => import('./ldrawGeneratedVisualChunks/chunk-11')
const loadVisualChunk12 = () => import('./ldrawGeneratedVisualChunks/chunk-12')
const loadVisualChunk13 = () => import('./ldrawGeneratedVisualChunks/chunk-13')
const loadVisualChunk14 = () => import('./ldrawGeneratedVisualChunks/chunk-14')
const loadVisualChunk15 = () => import('./ldrawGeneratedVisualChunks/chunk-15')
const loadVisualChunk16 = () => import('./ldrawGeneratedVisualChunks/chunk-16')
const loadVisualChunk17 = () => import('./ldrawGeneratedVisualChunks/chunk-17')
const loadVisualChunk18 = () => import('./ldrawGeneratedVisualChunks/chunk-18')
const loadVisualChunk19 = () => import('./ldrawGeneratedVisualChunks/chunk-19')
const loadVisualChunk20 = () => import('./ldrawGeneratedVisualChunks/chunk-20')
const loadVisualChunk21 = () => import('./ldrawGeneratedVisualChunks/chunk-21')
const loadVisualChunk22 = () => import('./ldrawGeneratedVisualChunks/chunk-22')
const loadVisualChunk23 = () => import('./ldrawGeneratedVisualChunks/chunk-23')
const loadVisualChunk24 = () => import('./ldrawGeneratedVisualChunks/chunk-24')
const loadVisualChunk25 = () => import('./ldrawGeneratedVisualChunks/chunk-25')
const loadVisualChunk26 = () => import('./ldrawGeneratedVisualChunks/chunk-26')
const loadVisualChunk27 = () => import('./ldrawGeneratedVisualChunks/chunk-27')
const loadVisualChunk28 = () => import('./ldrawGeneratedVisualChunks/chunk-28')
const loadVisualChunk29 = () => import('./ldrawGeneratedVisualChunks/chunk-29')
const loadVisualChunk30 = () => import('./ldrawGeneratedVisualChunks/chunk-30')
const loadVisualChunk31 = () => import('./ldrawGeneratedVisualChunks/chunk-31')
const loadVisualChunk32 = () => import('./ldrawGeneratedVisualChunks/chunk-32')
const loadVisualChunk33 = () => import('./ldrawGeneratedVisualChunks/chunk-33')
const loadVisualChunk34 = () => import('./ldrawGeneratedVisualChunks/chunk-34')
const loadVisualChunk35 = () => import('./ldrawGeneratedVisualChunks/chunk-35')
const loadVisualChunk36 = () => import('./ldrawGeneratedVisualChunks/chunk-36')
const loadVisualChunk37 = () => import('./ldrawGeneratedVisualChunks/chunk-37')
const loadVisualChunk38 = () => import('./ldrawGeneratedVisualChunks/chunk-38')
const loadVisualChunk39 = () => import('./ldrawGeneratedVisualChunks/chunk-39')
const loadVisualChunk40 = () => import('./ldrawGeneratedVisualChunks/chunk-40')
const loadVisualChunk41 = () => import('./ldrawGeneratedVisualChunks/chunk-41')
const loadVisualChunk42 = () => import('./ldrawGeneratedVisualChunks/chunk-42')
const loadVisualChunk43 = () => import('./ldrawGeneratedVisualChunks/chunk-43')
const loadVisualChunk44 = () => import('./ldrawGeneratedVisualChunks/chunk-44')
const loadVisualChunk45 = () => import('./ldrawGeneratedVisualChunks/chunk-45')
const loadVisualChunk46 = () => import('./ldrawGeneratedVisualChunks/chunk-46')
const loadVisualChunk47 = () => import('./ldrawGeneratedVisualChunks/chunk-47')
const loadVisualChunk48 = () => import('./ldrawGeneratedVisualChunks/chunk-48')
const loadVisualChunk49 = () => import('./ldrawGeneratedVisualChunks/chunk-49')
const loadVisualChunk50 = () => import('./ldrawGeneratedVisualChunks/chunk-50')
const loadVisualChunk51 = () => import('./ldrawGeneratedVisualChunks/chunk-51')
const loadVisualChunk52 = () => import('./ldrawGeneratedVisualChunks/chunk-52')
const loadVisualChunk53 = () => import('./ldrawGeneratedVisualChunks/chunk-53')
const loadVisualChunk54 = () => import('./ldrawGeneratedVisualChunks/chunk-54')
const loadVisualChunk55 = () => import('./ldrawGeneratedVisualChunks/chunk-55')
const loadVisualChunk56 = () => import('./ldrawGeneratedVisualChunks/chunk-56')
const loadVisualChunk57 = () => import('./ldrawGeneratedVisualChunks/chunk-57')
const loadVisualChunk58 = () => import('./ldrawGeneratedVisualChunks/chunk-58')
const loadVisualChunk59 = () => import('./ldrawGeneratedVisualChunks/chunk-59')
const loadVisualChunk60 = () => import('./ldrawGeneratedVisualChunks/chunk-60')
const loadVisualChunk61 = () => import('./ldrawGeneratedVisualChunks/chunk-61')
const loadVisualChunk62 = () => import('./ldrawGeneratedVisualChunks/chunk-62')
const loadVisualChunk63 = () => import('./ldrawGeneratedVisualChunks/chunk-63')
const loadVisualChunk64 = () => import('./ldrawGeneratedVisualChunks/chunk-64')
const loadVisualChunk65 = () => import('./ldrawGeneratedVisualChunks/chunk-65')
const loadVisualChunk66 = () => import('./ldrawGeneratedVisualChunks/chunk-66')
const loadVisualChunk67 = () => import('./ldrawGeneratedVisualChunks/chunk-67')
const loadVisualChunk68 = () => import('./ldrawGeneratedVisualChunks/chunk-68')
const loadVisualChunk69 = () => import('./ldrawGeneratedVisualChunks/chunk-69')
const loadVisualChunk70 = () => import('./ldrawGeneratedVisualChunks/chunk-70')
const loadVisualChunk71 = () => import('./ldrawGeneratedVisualChunks/chunk-71')
const loadVisualChunk72 = () => import('./ldrawGeneratedVisualChunks/chunk-72')
const loadVisualChunk73 = () => import('./ldrawGeneratedVisualChunks/chunk-73')
const loadVisualChunk74 = () => import('./ldrawGeneratedVisualChunks/chunk-74')
const loadVisualChunk75 = () => import('./ldrawGeneratedVisualChunks/chunk-75')
const loadVisualChunk76 = () => import('./ldrawGeneratedVisualChunks/chunk-76')
const loadVisualChunk77 = () => import('./ldrawGeneratedVisualChunks/chunk-77')
const loadVisualChunk78 = () => import('./ldrawGeneratedVisualChunks/chunk-78')
const loadVisualChunk79 = () => import('./ldrawGeneratedVisualChunks/chunk-79')
const loadVisualChunk80 = () => import('./ldrawGeneratedVisualChunks/chunk-80')
const loadVisualChunk81 = () => import('./ldrawGeneratedVisualChunks/chunk-81')
const loadVisualChunk82 = () => import('./ldrawGeneratedVisualChunks/chunk-82')
const loadVisualChunk83 = () => import('./ldrawGeneratedVisualChunks/chunk-83')
const loadVisualChunk84 = () => import('./ldrawGeneratedVisualChunks/chunk-84')
const loadVisualChunk85 = () => import('./ldrawGeneratedVisualChunks/chunk-85')
const loadVisualChunk86 = () => import('./ldrawGeneratedVisualChunks/chunk-86')
const loadVisualChunk87 = () => import('./ldrawGeneratedVisualChunks/chunk-87')
const loadVisualChunk88 = () => import('./ldrawGeneratedVisualChunks/chunk-88')
const loadVisualChunk89 = () => import('./ldrawGeneratedVisualChunks/chunk-89')
const loadVisualChunk90 = () => import('./ldrawGeneratedVisualChunks/chunk-90')
const loadVisualChunk91 = () => import('./ldrawGeneratedVisualChunks/chunk-91')
const loadVisualChunk92 = () => import('./ldrawGeneratedVisualChunks/chunk-92')
const loadVisualChunk93 = () => import('./ldrawGeneratedVisualChunks/chunk-93')
const loadVisualChunk94 = () => import('./ldrawGeneratedVisualChunks/chunk-94')
const loadVisualChunk95 = () => import('./ldrawGeneratedVisualChunks/chunk-95')
const loadVisualChunk96 = () => import('./ldrawGeneratedVisualChunks/chunk-96')
const loadVisualChunk97 = () => import('./ldrawGeneratedVisualChunks/chunk-97')
const loadVisualChunk98 = () => import('./ldrawGeneratedVisualChunks/chunk-98')
const loadVisualChunk99 = () => import('./ldrawGeneratedVisualChunks/chunk-99')
const loadVisualChunk100 = () => import('./ldrawGeneratedVisualChunks/chunk-100')
const loadVisualChunk101 = () => import('./ldrawGeneratedVisualChunks/chunk-101')
const loadVisualChunk102 = () => import('./ldrawGeneratedVisualChunks/chunk-102')
const loadVisualChunk103 = () => import('./ldrawGeneratedVisualChunks/chunk-103')
const loadVisualChunk104 = () => import('./ldrawGeneratedVisualChunks/chunk-104')
const loadVisualChunk105 = () => import('./ldrawGeneratedVisualChunks/chunk-105')
const loadVisualChunk106 = () => import('./ldrawGeneratedVisualChunks/chunk-106')
const loadVisualChunk107 = () => import('./ldrawGeneratedVisualChunks/chunk-107')
const loadVisualChunk108 = () => import('./ldrawGeneratedVisualChunks/chunk-108')
const loadVisualChunk109 = () => import('./ldrawGeneratedVisualChunks/chunk-109')
const loadVisualChunk110 = () => import('./ldrawGeneratedVisualChunks/chunk-110')
const loadVisualChunk111 = () => import('./ldrawGeneratedVisualChunks/chunk-111')
const loadVisualChunk112 = () => import('./ldrawGeneratedVisualChunks/chunk-112')
const loadVisualChunk113 = () => import('./ldrawGeneratedVisualChunks/chunk-113')
const loadVisualChunk114 = () => import('./ldrawGeneratedVisualChunks/chunk-114')
const loadVisualChunk115 = () => import('./ldrawGeneratedVisualChunks/chunk-115')
const loadVisualChunk116 = () => import('./ldrawGeneratedVisualChunks/chunk-116')
const loadVisualChunk117 = () => import('./ldrawGeneratedVisualChunks/chunk-117')
const loadVisualChunk118 = () => import('./ldrawGeneratedVisualChunks/chunk-118')
const loadVisualChunk119 = () => import('./ldrawGeneratedVisualChunks/chunk-119')
const loadVisualChunk120 = () => import('./ldrawGeneratedVisualChunks/chunk-120')
const loadVisualChunk121 = () => import('./ldrawGeneratedVisualChunks/chunk-121')
const loadVisualChunk122 = () => import('./ldrawGeneratedVisualChunks/chunk-122')
const loadVisualChunk123 = () => import('./ldrawGeneratedVisualChunks/chunk-123')
const loadVisualChunk124 = () => import('./ldrawGeneratedVisualChunks/chunk-124')
const loadVisualChunk125 = () => import('./ldrawGeneratedVisualChunks/chunk-125')
const loadVisualChunk126 = () => import('./ldrawGeneratedVisualChunks/chunk-126')
const loadVisualChunk127 = () => import('./ldrawGeneratedVisualChunks/chunk-127')
const loadVisualChunk128 = () => import('./ldrawGeneratedVisualChunks/chunk-128')
const loadVisualChunk129 = () => import('./ldrawGeneratedVisualChunks/chunk-129')
const loadVisualChunk130 = () => import('./ldrawGeneratedVisualChunks/chunk-130')
const loadVisualChunk131 = () => import('./ldrawGeneratedVisualChunks/chunk-131')
const loadVisualChunk132 = () => import('./ldrawGeneratedVisualChunks/chunk-132')
const loadVisualChunk133 = () => import('./ldrawGeneratedVisualChunks/chunk-133')
const loadVisualChunk134 = () => import('./ldrawGeneratedVisualChunks/chunk-134')
const loadVisualChunk135 = () => import('./ldrawGeneratedVisualChunks/chunk-135')
const loadVisualChunk136 = () => import('./ldrawGeneratedVisualChunks/chunk-136')
const loadVisualChunk137 = () => import('./ldrawGeneratedVisualChunks/chunk-137')
const loadVisualChunk138 = () => import('./ldrawGeneratedVisualChunks/chunk-138')
const loadVisualChunk139 = () => import('./ldrawGeneratedVisualChunks/chunk-139')
const loadVisualChunk140 = () => import('./ldrawGeneratedVisualChunks/chunk-140')
const loadVisualChunk141 = () => import('./ldrawGeneratedVisualChunks/chunk-141')
const loadVisualChunk142 = () => import('./ldrawGeneratedVisualChunks/chunk-142')
const loadVisualChunk143 = () => import('./ldrawGeneratedVisualChunks/chunk-143')
const loadVisualChunk144 = () => import('./ldrawGeneratedVisualChunks/chunk-144')
const loadVisualChunk145 = () => import('./ldrawGeneratedVisualChunks/chunk-145')
const loadVisualChunk146 = () => import('./ldrawGeneratedVisualChunks/chunk-146')
const loadVisualChunk147 = () => import('./ldrawGeneratedVisualChunks/chunk-147')
const loadVisualChunk148 = () => import('./ldrawGeneratedVisualChunks/chunk-148')
const loadVisualChunk149 = () => import('./ldrawGeneratedVisualChunks/chunk-149')
const loadVisualChunk150 = () => import('./ldrawGeneratedVisualChunks/chunk-150')
const loadVisualChunk151 = () => import('./ldrawGeneratedVisualChunks/chunk-151')
const loadVisualChunk152 = () => import('./ldrawGeneratedVisualChunks/chunk-152')
const loadVisualChunk153 = () => import('./ldrawGeneratedVisualChunks/chunk-153')
const loadVisualChunk154 = () => import('./ldrawGeneratedVisualChunks/chunk-154')
const loadVisualChunk155 = () => import('./ldrawGeneratedVisualChunks/chunk-155')
const loadVisualChunk156 = () => import('./ldrawGeneratedVisualChunks/chunk-156')
const loadVisualChunk157 = () => import('./ldrawGeneratedVisualChunks/chunk-157')
const loadVisualChunk158 = () => import('./ldrawGeneratedVisualChunks/chunk-158')
const loadVisualChunk159 = () => import('./ldrawGeneratedVisualChunks/chunk-159')
const loadVisualChunk160 = () => import('./ldrawGeneratedVisualChunks/chunk-160')
const loadVisualChunk161 = () => import('./ldrawGeneratedVisualChunks/chunk-161')
const loadVisualChunk162 = () => import('./ldrawGeneratedVisualChunks/chunk-162')
const loadVisualChunk163 = () => import('./ldrawGeneratedVisualChunks/chunk-163')
const loadVisualChunk164 = () => import('./ldrawGeneratedVisualChunks/chunk-164')
const loadVisualChunk165 = () => import('./ldrawGeneratedVisualChunks/chunk-165')
const loadVisualChunk166 = () => import('./ldrawGeneratedVisualChunks/chunk-166')
const loadVisualChunk167 = () => import('./ldrawGeneratedVisualChunks/chunk-167')
const loadVisualChunk168 = () => import('./ldrawGeneratedVisualChunks/chunk-168')
const loadVisualChunk169 = () => import('./ldrawGeneratedVisualChunks/chunk-169')
const loadVisualChunk170 = () => import('./ldrawGeneratedVisualChunks/chunk-170')
const loadVisualChunk171 = () => import('./ldrawGeneratedVisualChunks/chunk-171')
const loadVisualChunk172 = () => import('./ldrawGeneratedVisualChunks/chunk-172')
const loadVisualChunk173 = () => import('./ldrawGeneratedVisualChunks/chunk-173')
const loadVisualChunk174 = () => import('./ldrawGeneratedVisualChunks/chunk-174')
const loadVisualChunk175 = () => import('./ldrawGeneratedVisualChunks/chunk-175')
const loadVisualChunk176 = () => import('./ldrawGeneratedVisualChunks/chunk-176')
const loadVisualChunk189 = () => import('./ldrawGeneratedVisualChunks/chunk-189')
const loadVisualChunk190 = () => import('./ldrawGeneratedVisualChunks/chunk-190')
const loadVisualChunk191 = () => import('./ldrawGeneratedVisualChunks/chunk-191')
const loadVisualChunk192 = () => import('./ldrawGeneratedVisualChunks/chunk-192')
const loadVisualChunk193 = () => import('./ldrawGeneratedVisualChunks/chunk-193')
const loadVisualChunk194 = () => import('./ldrawGeneratedVisualChunks/chunk-194')
const loadVisualChunk195 = () => import('./ldrawGeneratedVisualChunks/chunk-195')
const loadVisualChunk196 = () => import('./ldrawGeneratedVisualChunks/chunk-196')
const loadVisualChunk197 = () => import('./ldrawGeneratedVisualChunks/chunk-197')
const loadVisualChunk198 = () => import('./ldrawGeneratedVisualChunks/chunk-198')
const loadVisualChunk199 = () => import('./ldrawGeneratedVisualChunks/chunk-199')
const loadVisualChunk200 = () => import('./ldrawGeneratedVisualChunks/chunk-200')
const loadVisualChunk201 = () => import('./ldrawGeneratedVisualChunks/chunk-201')
const loadVisualChunk202 = () => import('./ldrawGeneratedVisualChunks/chunk-202')
const loadVisualChunk203 = () => import('./ldrawGeneratedVisualChunks/chunk-203')
const loadVisualChunk204 = () => import('./ldrawGeneratedVisualChunks/chunk-204')
const loadVisualChunk205 = () => import('./ldrawGeneratedVisualChunks/chunk-205')
const loadVisualChunk206 = () => import('./ldrawGeneratedVisualChunks/chunk-206')

export const ldrawGeneratedVisualChunkLoaders: Record<
  string,
  () => Promise<LDrawGeneratedVisualChunk>
> = {
  "11477": loadVisualChunk0,
  "13971": loadVisualChunk0,
  "15397": loadVisualChunk0,
  "15573": loadVisualChunk0,
  "2412": loadVisualChunk0,
  "2431": loadVisualChunk0,
  "2479": loadVisualChunk0,
  "2926": loadVisualChunk0,
  "30000": loadVisualChunk1,
  "3001": loadVisualChunk1,
  "3002": loadVisualChunk1,
  "3003": loadVisualChunk1,
  "3004": loadVisualChunk1,
  "30044": loadVisualChunk1,
  "3005": loadVisualChunk1,
  "3007": loadVisualChunk1,
  "3009": loadVisualChunk2,
  "3010": loadVisualChunk2,
  "3020": loadVisualChunk2,
  "3021": loadVisualChunk2,
  "3022": loadVisualChunk2,
  "3023": loadVisualChunk2,
  "30236": loadVisualChunk2,
  "3024": loadVisualChunk2,
  "3031": loadVisualChunk2,
  "3032": loadVisualChunk3,
  "3034": loadVisualChunk3,
  "3035": loadVisualChunk4,
  "3036": loadVisualChunk5,
  "3037": loadVisualChunk6,
  "3039": loadVisualChunk6,
  "3040": loadVisualChunk6,
  "30414": loadVisualChunk6,
  "3062": loadVisualChunk6,
  "3065": loadVisualChunk6,
  "3069": loadVisualChunk6,
  "3070": loadVisualChunk6,
  "3184": loadVisualChunk6,
  "34337": loadVisualChunk6,
  "3622": loadVisualChunk6,
  "3623": loadVisualChunk6,
  "3659": loadVisualChunk6,
  "3660": loadVisualChunk6,
  "3665": loadVisualChunk6,
  "3666": loadVisualChunk7,
  "3679": loadVisualChunk7,
  "3680": loadVisualChunk7,
  "3684": loadVisualChunk7,
  "3710": loadVisualChunk7,
  "3747": loadVisualChunk7,
  "3795": loadVisualChunk7,
  "3941": loadVisualChunk7,
  "3942": loadVisualChunk7,
  "4032": loadVisualChunk8,
  "4070": loadVisualChunk8,
  "4073": loadVisualChunk8,
  "4286": loadVisualChunk8,
  "4460": loadVisualChunk8,
  "44728": loadVisualChunk8,
  "4589": loadVisualChunk8,
  "4600": loadVisualChunk8,
  "4624": loadVisualChunk8,
  "49668": loadVisualChunk8,
  "50950": loadVisualChunk8,
  "54200": loadVisualChunk8,
  "60032": loadVisualChunk8,
  "6014": loadVisualChunk9,
  "60478": loadVisualChunk9,
  "60481": loadVisualChunk9,
  "6091": loadVisualChunk9,
  "61252": loadVisualChunk9,
  "61254": loadVisualChunk9,
  "61678": loadVisualChunk9,
  "6215": loadVisualChunk9,
  "6232": loadVisualChunk9,
  "63868": loadVisualChunk9,
  "64799": loadVisualChunk10,
  "67737": loadVisualChunk10,
  "75937": loadVisualChunk10,
  "85984": loadVisualChunk10,
  "87079": loadVisualChunk10,
  "87087": loadVisualChunk10,
  "87414": loadVisualChunk11,
  "87580": loadVisualChunk11,
  "87697": loadVisualChunk11,
  "88292": loadVisualChunk11,
  "88930": loadVisualChunk11,
  "92438": loadVisualChunk12,
  "92947": loadVisualChunk13,
  "93273": loadVisualChunk13,
  "94161": loadVisualChunk13,
  "96874": loadVisualChunk14,
  "98100": loadVisualChunk14,
  "98138": loadVisualChunk14,
  "98263": loadVisualChunk15,
  "2419": loadVisualChunk16,
  "3700": loadVisualChunk16,
  "43898": loadVisualChunk16,
  "85080": loadVisualChunk16,
  "87081": loadVisualChunk17,
  "3033": loadVisualChunk18,
  "3688": loadVisualChunk19,
  "4162": loadVisualChunk19,
  "4733": loadVisualChunk19,
  "47905": loadVisualChunk19,
  "59900": loadVisualChunk19,
  "2357": loadVisualChunk20,
  "2458": loadVisualChunk20,
  "30165": loadVisualChunk20,
  "3028": loadVisualChunk21,
  "3030": loadVisualChunk22,
  "30374": loadVisualChunk22,
  "3068": loadVisualChunk22,
  "3460": loadVisualChunk22,
  "3832": loadVisualChunk23,
  "4477": loadVisualChunk24,
  "60479": loadVisualChunk24,
  "63864": loadVisualChunk24,
  "6541": loadVisualChunk24,
  "6636": loadVisualChunk24,
  "3044b": loadVisualChunk25,
  "3794a": loadVisualChunk25,
  "3794b": loadVisualChunk25,
  "3957b": loadVisualChunk25,
  "4150p03": loadVisualChunk25,
  "4162p08": loadVisualChunk25,
  "4162p0b": loadVisualChunk25,
  "4162p0g": loadVisualChunk25,
  "4865a": loadVisualChunk25,
  "6636p01": loadVisualChunk26,
  "6636p02": loadVisualChunk26,
  "3176": loadVisualChunk27,
  "43719": loadVisualChunk27,
  "85861": loadVisualChunk27,
  "87994": loadVisualChunk27,
  "10830": loadVisualChunk28,
  "11211": loadVisualChunk28,
  "11212": loadVisualChunk28,
  "11213": loadVisualChunk29,
  "11214": loadVisualChunk30,
  "11253": loadVisualChunk30,
  "11476": loadVisualChunk30,
  "11833": loadVisualChunk30,
  "13731": loadVisualChunk30,
  "13965": loadVisualChunk30,
  "14395": loadVisualChunk31,
  "14716": loadVisualChunk31,
  "14718": loadVisualChunk31,
  "14719": loadVisualChunk31,
  "14769": loadVisualChunk31,
  "15068": loadVisualChunk31,
  "15070": loadVisualChunk31,
  "15082": loadVisualChunk31,
  "15207": loadVisualChunk31,
  "15254": loadVisualChunk31,
  "15533": loadVisualChunk31,
  "15571": loadVisualChunk31,
  "15672": loadVisualChunk31,
  "15706": loadVisualChunk31,
  "15712": loadVisualChunk31,
  "16000": loadVisualChunk32,
  "16001": loadVisualChunk32,
  "16577": loadVisualChunk32,
  "17485": loadVisualChunk32,
  "18031": loadVisualChunk32,
  "18646": loadVisualChunk32,
  "18674": loadVisualChunk33,
  "18677": loadVisualChunk33,
  "18838": loadVisualChunk33,
  "18980": loadVisualChunk33,
  "19119": loadVisualChunk33,
  "20430": loadVisualChunk34,
  "20460b": loadVisualChunk34,
  "20461b": loadVisualChunk34,
  "20482": loadVisualChunk34,
  "21269": loadVisualChunk34,
  "22885": loadVisualChunk34,
  "22886": loadVisualChunk34,
  "22888": loadVisualChunk35,
  "2339": loadVisualChunk35,
  "2343": loadVisualChunk35,
  "23949": loadVisualChunk35,
  "23996": loadVisualChunk36,
  "2412b": loadVisualChunk36,
  "2420": loadVisualChunk36,
  "24246": loadVisualChunk36,
  "2429": loadVisualChunk36,
  "2430": loadVisualChunk36,
  "24309": loadVisualChunk36,
  "2445": loadVisualChunk37,
  "24482": loadVisualChunk37,
  "2453": loadVisualChunk37,
  "2453b": loadVisualChunk37,
  "2454": loadVisualChunk37,
  "2454b": loadVisualChunk37,
  "2456": loadVisualChunk37,
  "2462": loadVisualChunk37,
  "2465": loadVisualChunk38,
  "24855": loadVisualChunk38,
  "24866": loadVisualChunk38,
  "25269": loadVisualChunk38,
  "2555": loadVisualChunk38,
  "25893": loadVisualChunk38,
  "25893a": loadVisualChunk38,
  "26047": loadVisualChunk38,
  "26601": loadVisualChunk38,
  "26603": loadVisualChunk38,
  "26604": loadVisualChunk39,
  "2723": loadVisualChunk39,
  "2730": loadVisualChunk39,
  "27507": loadVisualChunk39,
  "2780": loadVisualChunk40,
  "27925": loadVisualChunk40,
  "28588": loadVisualChunk40,
  "2877": loadVisualChunk40,
  "29111": loadVisualChunk40,
  "29119": loadVisualChunk40,
  "29120": loadVisualChunk40,
  "2921": loadVisualChunk40,
  "3006": loadVisualChunk41,
  "3008": loadVisualChunk41,
  "30115": loadVisualChunk42,
  "30136": loadVisualChunk42,
  "30152ap01": loadVisualChunk42,
  "3023b": loadVisualChunk42,
  "30350": loadVisualChunk42,
  "30350b": loadVisualChunk42,
  "30357": loadVisualChunk43,
  "30361": loadVisualChunk43,
  "30361d": loadVisualChunk43,
  "30375": loadVisualChunk43,
  "3038": loadVisualChunk43,
  "3040b": loadVisualChunk43,
  "30413": loadVisualChunk43,
  "3043": loadVisualChunk43,
  "3044c": loadVisualChunk43,
  "3045": loadVisualChunk43,
  "3046": loadVisualChunk44,
  "3049": loadVisualChunk44,
  "3049d": loadVisualChunk44,
  "30503": loadVisualChunk44,
  "30504": loadVisualChunk45,
  "30526": loadVisualChunk45,
  "30562": loadVisualChunk46,
  "30565": loadVisualChunk46,
  "3062b": loadVisualChunk46,
  "3068b": loadVisualChunk46,
  "3069b": loadVisualChunk46,
  "3070b": loadVisualChunk46,
  "32000": loadVisualChunk46,
  "32018": loadVisualChunk47,
  "32028": loadVisualChunk47,
  "32054": loadVisualChunk48,
  "32124": loadVisualChunk48,
  "32316": loadVisualChunk48,
  "3245b": loadVisualChunk48,
  "32524": loadVisualChunk49,
  "32531": loadVisualChunk50,
  "32531b": loadVisualChunk51,
  "32532": loadVisualChunk52,
  "32532b": loadVisualChunk53,
  "32555": loadVisualChunk54,
  "32952": loadVisualChunk54,
  "3298": loadVisualChunk54,
  "3308a": loadVisualChunk54,
  "33286": loadVisualChunk54,
  "33291": loadVisualChunk54,
  "33909": loadVisualChunk54,
  "34103": loadVisualChunk54,
  "3456": loadVisualChunk55,
  "35464": loadVisualChunk56,
  "36036": loadVisualChunk56,
  "36036p01": loadVisualChunk56,
  "3626": loadVisualChunk56,
  "3626c": loadVisualChunk56,
  "3660b": loadVisualChunk56,
  "3665b": loadVisualChunk56,
  "3676": loadVisualChunk57,
  "3678": loadVisualChunk57,
  "3678b": loadVisualChunk57,
  "3701": loadVisualChunk57,
  "3702": loadVisualChunk57,
  "3703": loadVisualChunk58,
  "3705": loadVisualChunk59,
  "3741a": loadVisualChunk59,
  "3743": loadVisualChunk59,
  "3747b": loadVisualChunk59,
  "3749": loadVisualChunk59,
  "37775": loadVisualChunk59,
  "3815b": loadVisualChunk59,
  "3816c": loadVisualChunk59,
  "3817c": loadVisualChunk59,
  "3818": loadVisualChunk60,
  "3819": loadVisualChunk60,
  "3820": loadVisualChunk60,
  "38317": loadVisualChunk60,
  "3839": loadVisualChunk60,
  "3839b": loadVisualChunk60,
  "38583": loadVisualChunk60,
  "38585": loadVisualChunk60,
  "38801": loadVisualChunk60,
  "3894": loadVisualChunk61,
  "3895": loadVisualChunk62,
  "3937": loadVisualChunk62,
  "3942c": loadVisualChunk62,
  "3943b": loadVisualChunk63,
  "3957": loadVisualChunk63,
  "3957a": loadVisualChunk63,
  "3960": loadVisualChunk63,
  "4032a": loadVisualChunk63,
  "4081": loadVisualChunk63,
  "4081b": loadVisualChunk63,
  "4085c": loadVisualChunk64,
  "4095": loadVisualChunk64,
  "4150": loadVisualChunk64,
  "41539": loadVisualChunk65,
  "42446": loadVisualChunk66,
  "4274": loadVisualChunk66,
  "4282": loadVisualChunk66,
  "4287": loadVisualChunk66,
  "4287c": loadVisualChunk66,
  "43093": loadVisualChunk67,
  "43722": loadVisualChunk67,
  "43723": loadVisualChunk67,
  "44237": loadVisualChunk67,
  "44302": loadVisualChunk67,
  "44302b": loadVisualChunk68,
  "4490": loadVisualChunk68,
  "4510": loadVisualChunk68,
  "45301": loadVisualChunk69,
  "4599": loadVisualChunk69,
  "4599a": loadVisualChunk70,
  "47397": loadVisualChunk70,
  "47398": loadVisualChunk70,
  "4740": loadVisualChunk71,
  "4742": loadVisualChunk71,
  "47457": loadVisualChunk71,
  "47543": loadVisualChunk71,
  "48092": loadVisualChunk71,
  "48336": loadVisualChunk71,
  "4865": loadVisualChunk71,
  "4865b": loadVisualChunk71,
  "48723": loadVisualChunk72,
  "50231": loadVisualChunk72,
  "50304": loadVisualChunk72,
  "50305": loadVisualChunk72,
  "51739": loadVisualChunk72,
  "53451": loadVisualChunk73,
  "53989": loadVisualChunk73,
  "55236": loadVisualChunk73,
  "59349": loadVisualChunk73,
  "6003": loadVisualChunk74,
  "60474": loadVisualChunk75,
  "60475": loadVisualChunk75,
  "60475b": loadVisualChunk75,
  "60477": loadVisualChunk75,
  "60481b": loadVisualChunk75,
  "60581": loadVisualChunk76,
  "60601": loadVisualChunk76,
  "60601p01": loadVisualChunk76,
  "60808": loadVisualChunk76,
  "6082": loadVisualChunk77,
  "60897": loadVisualChunk77,
  "6106": loadVisualChunk78,
  "6108": loadVisualChunk78,
  "6111": loadVisualChunk78,
  "6112": loadVisualChunk78,
  "6134": loadVisualChunk79,
  "6141": loadVisualChunk79,
  "6143": loadVisualChunk79,
  "61485": loadVisualChunk79,
  "6179": loadVisualChunk79,
  "6182": loadVisualChunk79,
  "6233": loadVisualChunk80,
  "6259": loadVisualChunk80,
  "6269": loadVisualChunk80,
  "63965": loadVisualChunk80,
  "64644": loadVisualChunk80,
  "64647": loadVisualChunk81,
  "64807": loadVisualChunk81,
  "6558": loadVisualChunk81,
  "6562": loadVisualChunk82,
  "73983": loadVisualChunk82,
  "76768": loadVisualChunk82,
  "85970": loadVisualChunk82,
  "85975": loadVisualChunk82,
  "87620": loadVisualChunk82,
  "88072": loadVisualChunk82,
  "90195": loadVisualChunk82,
  "90398": loadVisualChunk83,
  "90540": loadVisualChunk83,
  "92582": loadVisualChunk83,
  "92593": loadVisualChunk83,
  "92946": loadVisualChunk83,
  "92950": loadVisualChunk83,
  "93069": loadVisualChunk83,
  "93223": loadVisualChunk84,
  "93274": loadVisualChunk84,
  "93549": loadVisualChunk84,
  "93552": loadVisualChunk84,
  "93888": loadVisualChunk84,
  "95225": loadVisualChunk85,
  "970": loadVisualChunk85,
  "973": loadVisualChunk85,
  "98283": loadVisualChunk85,
  "98370": loadVisualChunk85,
  "98374": loadVisualChunk85,
  "99206": loadVisualChunk85,
  "99207": loadVisualChunk85,
  "99780": loadVisualChunk86,
  "99781": loadVisualChunk86,
  "16478": loadVisualChunk87,
  "3245c": loadVisualChunk88,
  "98313": loadVisualChunk89,
  "3010pbf71043s08": loadVisualChunk90,
  "11477pbf71043s19": loadVisualChunk91,
  "11477pbf71043s20": loadVisualChunk91,
  "15068pbf71043s17": loadVisualChunk91,
  "15068pbf71043s18": loadVisualChunk92,
  "15068pbf71043s21": loadVisualChunk93,
  "15068pbf71043s22": loadVisualChunk94,
  "2723pbf71043s27": loadVisualChunk95,
  "36841": loadVisualChunk96,
  "87079pbf71043s52": loadVisualChunk97,
  "87079pbf71043s53": loadVisualChunk98,
  "3010pbf71043s07": loadVisualChunk99,
  "60808pbf71043s09": loadVisualChunk100,
  "3245cpbf71043s25": loadVisualChunk101,
  "3245cpbf71043s26": loadVisualChunk102,
  "32952pbf71043s24": loadVisualChunk103,
  "3245cpbf71043s28": loadVisualChunk104,
  "4150pbf71043s30": loadVisualChunk105,
  "60581pbf71043s29": loadVisualChunk106,
  "30350bpbf71043s56": loadVisualChunk107,
  "30350bpbf71043s57": loadVisualChunk108,
  "30350bpbf71043s58": loadVisualChunk109,
  "30350bpbf71043s59": loadVisualChunk110,
  "30562pbf71043s01": loadVisualChunk111,
  "30562pbf71043s02": loadVisualChunk112,
  "30562pbf71043s03": loadVisualChunk113,
  "30562pbf71043s04": loadVisualChunk114,
  "30562pbf71043s05": loadVisualChunk115,
  "30562pbf71043s06": loadVisualChunk116,
  "24309pbf71043s11": loadVisualChunk117,
  "24309pbf71043s11r": loadVisualChunk118,
  "3069bpbf71043s23": loadVisualChunk119,
  "50950pbf71043s11": loadVisualChunk120,
  "22885pbf71043s10": loadVisualChunk121,
  "22885pbf71043s13": loadVisualChunk122,
  "22885pbf71043s14": loadVisualChunk123,
  "3010pbf71043s07r": loadVisualChunk124,
  "3245bpbf71043s15": loadVisualChunk125,
  "3245bpbf71043s16": loadVisualChunk126,
  "87079pbf71043s12": loadVisualChunk127,
  "2454bpbf71043s39": loadVisualChunk128,
  "59349pbf71043s37": loadVisualChunk129,
  "59349pbf71043s41": loadVisualChunk130,
  "2454bpbf71043s46": loadVisualChunk131,
  "59349pbf71043s45": loadVisualChunk132,
  "59349pbf71043s47": loadVisualChunk133,
  "93549pat0002": loadVisualChunk134,
  "59349pbf71043s31": loadVisualChunk135,
  "60581pbf71043s40": loadVisualChunk136,
  "3069bpbf71043s35": loadVisualChunk137,
  "3069bpbf71043s54": loadVisualChunk138,
  "3069bpbf71043s55": loadVisualChunk138,
  "60581pbf71043s38": loadVisualChunk139,
  "2454bpbf71043s33": loadVisualChunk140,
  "2454bpbf71043s43": loadVisualChunk141,
  "3007pbf71043s42": loadVisualChunk142,
  "3678bpbf71043s44": loadVisualChunk143,
  "10830pat0001": loadVisualChunk144,
  "3068bpbf71043s48": loadVisualChunk145,
  "3068bpbf71043s49": loadVisualChunk146,
  "87079pbf71043s50": loadVisualChunk147,
  "87079pbf71043s51": loadVisualChunk148,
  "14718pbf71043s32": loadVisualChunk149,
  "2454bpbf71043s34": loadVisualChunk150,
  "2454bpbf71043s36": loadVisualChunk151,
  "3004pbf71043s33": loadVisualChunk152,
  "90398pbf71043e6240385": loadVisualChunk153,
  "90398pbf71043e6240389": loadVisualChunk154,
  "90398pbf71043e6240394": loadVisualChunk155,
  "90398pbf71043e6240398": loadVisualChunk156,
  "90398pbf71043e6240406": loadVisualChunk157,
  "90398pbf71043e6240409": loadVisualChunk158,
  "90398pbf71043e6240411": loadVisualChunk159,
  "90398pbf71043e6240412": loadVisualChunk160,
  "90398pbf71043e6240413": loadVisualChunk161,
  "90398pbf71043e6240425": loadVisualChunk162,
  "90398pbf71043e6240426": loadVisualChunk163,
  "90398pbf71043e6240428": loadVisualChunk164,
  "90398pbf71043e6240472": loadVisualChunk165,
  "90398pbf71043e6240473": loadVisualChunk166,
  "90398pbf71043e6240474": loadVisualChunk167,
  "90398pbf71043e6240475": loadVisualChunk168,
  "90398pbf71043e6240521": loadVisualChunk169,
  "90398pbf71043e6240522": loadVisualChunk170,
  "90398pbf71043e6240523": loadVisualChunk171,
  "90398pbf71043e6240524": loadVisualChunk172,
  "90398pbf71043e6240530": loadVisualChunk173,
  "90398pbf71043e6240537": loadVisualChunk174,
  "90398pbf71043e6240539": loadVisualChunk175,
  "90398pbf71043e6240540": loadVisualChunk176,
  "36036pbf71043e6244583": loadVisualChunk189,
  "36036pbf71043e6244584": loadVisualChunk190,
  "3626cpbf71043e6240414": loadVisualChunk191,
  "3626cpbf71043e6240417": loadVisualChunk192,
  "3626cpbf71043e6240418": loadVisualChunk193,
  "3626cpbf71043e6240419": loadVisualChunk194,
  "970pbf71043e6240420": loadVisualChunk195,
  "970pbf71043e6240423": loadVisualChunk196,
  "973pbf71043e6240433": loadVisualChunk197,
  "973pbf71043e6240437": loadVisualChunk198,
  "973pbf71043e6240440": loadVisualChunk199,
  "973pbf71043e6244851": loadVisualChunk200,
  "20551c01": loadVisualChunk201,
  "36752a": loadVisualChunk201,
  "50231c01": loadVisualChunk201,
  "14769pbf71043s30": loadVisualChunk202,
  "3068bpbf71043s60": loadVisualChunk203,
  "3068bpbf71043s61": loadVisualChunk204,
  "3068bpbf71043s62": loadVisualChunk205,
  "3068bpbf71043s63": loadVisualChunk206,
}

export const ldrawGeneratedVisualPartNumbers = Object.keys(ldrawGeneratedVisualChunkLoaders)
