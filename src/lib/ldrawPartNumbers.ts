const exactReplicaParts = new Set(["96874","36752a","20551c01","50231c01","3245c","20460b","20461b","2412b","2453b","2454b","25893a","30152ap01","3023b","30350b","30361d","3040b","3044c","3049d","3062b","3068b","3069b","3070b","3245b","32531b","32532b","3308a","36036p01","3626c","3660b","3665b","3678b","3741a","3747b","3794b","3815b","3816c","3817c","3839b","38801p01","3942c","3943b","3957a","3957b","4032a","4081b","4085c","4287c","44302b","4599a","4865b","60475b","60481b","60601p01"])
export const normalizeLDrawPartNumber = (partNumber: string) => {
  const stem = partNumber.toLowerCase().replace(/\.dat$/, '')
  if (exactReplicaParts.has(stem)) return stem
  if (['3794a', '3794b', '3044b', '3957b', '4865a'].includes(stem)) return stem
  const printedNumber = partNumber.toLowerCase().match(/^\d+[a-z]*p[0-9a-z]+/)?.[0]
  if (printedNumber) return printedNumber
  const baseNumber = partNumber.match(/^\d+/)?.[0]
  return baseNumber ?? partNumber.toLowerCase()
}
