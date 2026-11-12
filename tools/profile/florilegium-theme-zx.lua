-- ZX artwork for Florilegium v2.0.1. Upstream grows and places everything.
local ink = require("florilegium-ink")
local green, red = {0.24,0.49,0.39}, {0.73,0.40,0.32}
local palette = {green,red}
local wire, yellow = {0.35,0.45,0.40}, {0.81,0.66,0.37}
local pi, sin, cos = math.pi, math.sin, math.cos

-- Honour Florilegium's pale background layer.
local function tint(c,pale)
  local t = 1-(1-ink.get_lift())*(1-(pale or 0))
  return {c[1]+(1-c[1])*t, c[2]+(1-c[2])*t, c[3]+(1-c[3])*t}
end

local function edge(a,b)
  ink.poly({a,b},false) ink.stroke(tint(wire),0.5)
end

local function spider(p,r,color)
  if r*ink.unit() > 0.07 then
    ink.circle(p[1],p[2],r*1.35) ink.fill(tint(color,0.9))
  end
  ink.circle(p[1],p[2],r) ink.fill(tint(color))
end

local function hadamard(p,r)
  local x,y = p[1],p[2]
  ink.poly({{x-r,y-r},{x+r,y-r},{x+r,y+r},{x-r,y+r}},true)
  ink.fill(tint(yellow))
end

local function target(p,r)
  local x,y = p[1],p[2]
  ink.circle(x,y,r) ink.fill(ink.white)
  ink.circle(x,y,r) ink.stroke(tint(red),0.5)
  edge({x-r,y},{x+r,y}) edge({x,y-r},{x,y+r})
end

local function dot(rng,r)
  spider({0,0},r,rng.pick(palette))
end

-- Connected diagrams with varying arities, edges and Hadamard boxes.
local function graph(rng,s)
  local points, boxes, n = {{0,0}}, {}, rng.int(4,6)
  for i = 2,n do
    local a = 2*pi*(i-2)/(n-1)+rng.sym(0.25)
    local r = s*rng.range(0.45,0.8)
    local x,y = cos(a),sin(a)
    local point = {r*x,r*y}
    points[i] = point
    local parent = points[rng.int(1,i-1)]
    edge(parent,point)
    if rng.chance(0.25) then
      boxes[#boxes+1] = {(parent[1]+point[1])/2,(parent[2]+point[2])/2}
    end
    if i > 3 and parent ~= points[i-1] and rng.chance(0.4) then edge(points[i-1],point) end
    if rng.chance(0.4) then edge(point,{0.98*s*x,0.98*s*y}) end
  end
  for _,p in ipairs(boxes) do hadamard(p,0.06*s) end
  for _,p in ipairs(points) do spider(p,0.085*s,rng.pick(palette)) end
end

local function chain(rng,L)
  local previous, n = {0,0}, rng.int(1,3)
  spider(previous,0.045*L,green)
  for i = 1,n do
    local p = {rng.sym(0.12)*L,i*L/(n+1)}
    edge(previous,p)
    if rng.chance(0.3) then hadamard(p,0.055*L)
    else spider(p,0.065*L,rng.pick(palette)) end
    previous = p
  end
  edge(previous,{0,L})
end

local function circuit(rng,L)
  for _,x in ipairs({-0.18*L,0.18*L}) do
    edge({0,0},{x,0.12*L}) edge({x,0.12*L},{x,L})
  end
  spider({0,0},0.045*L,green)
  local n = rng.int(2,4)
  for i = 1,n do
    local x,y = rng.pick({-0.18,0.18})*L,(0.12+0.8*i/(n+1))*L
    if rng.chance(0.5) then hadamard({x,y},0.065*L)
    else
      edge({x,y},{-x,y})
      spider({x,y},0.055*L,green)
      target({-x,y},0.075*L)
    end
  end
end

local function leaf(rng) chain(rng,1) end
local function quiet() end -- Omit the engine's scattered, unconnected filler dots.

local function stem(points)
  -- Omit spirals. Ordinary stems and branches never make a full turn.
  local turn = 0
  for i = 3,#points do
    local a,b,c = points[i-2],points[i-1],points[i]
    local dx,dy = b[1]-a[1],b[2]-a[2]
    local ex,ey = c[1]-b[1],c[2]-b[2]
    turn = turn+math.atan(dx*ey-dy*ex,dx*ex+dy*ey)
  end
  if math.abs(turn) < 2*pi then
    ink.smooth(points,false) ink.stroke(tint(wire),0.6)
  end
end

return {
  version = "2.0.1",
  flora = {
    stem=stem,
    flower=graph, lily=graph, blossom=graph,
    bud=chain, bell=graph, floret=dot,
    leaf=leaf, leaflet=leaf,
    cyme=circuit, sprig=chain, umbel=circuit, tendril=chain,
    sparkle=quiet, rosette=quiet,
    hedera=function() return ink.to_page(0,0) end,
  },
}
