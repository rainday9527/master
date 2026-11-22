"""Convert generated GLB meshes to Cocos runtime JSON + baked texture."""
import json
import math
import struct
import sys
from pathlib import Path
from PIL import Image
import io

source, target = map(Path, sys.argv[1:3])
b = source.read_bytes()
n = struct.unpack_from('<I', b, 12)[0]
g = json.loads(b[20:20+n])
binary = b[28+n:]
primitive = g['meshes'][0]['primitives'][0]

def accessor(index):
    a = g['accessors'][index]
    v = g['bufferViews'][a['bufferView']]
    components = {'SCALAR':1, 'VEC2':2, 'VEC3':3, 'VEC4':4}[a['type']]
    fmt, size = {5126:('f',4),5125:('I',4),5123:('H',2),5121:('B',1)}[a['componentType']]
    offset = v.get('byteOffset',0) + a.get('byteOffset',0)
    stride = v.get('byteStride', components * size)
    return [value for i in range(a['count']) for value in struct.unpack_from('<'+fmt*components,binary,offset+i*stride)]

positions = accessor(primitive['attributes']['POSITION'])
normals = accessor(primitive['attributes']['NORMAL'])
uvs = accessor(primitive['attributes']['TEXCOORD_0'])
indices = accessor(primitive['indices'])
node = next(x for x in g['nodes'] if x.get('mesh') == 0)
q = node.get('rotation',[0,0,0,1])

def rotate(x,y,z):
    qx,qy,qz,qw=q
    tx,ty,tz=2*(qy*z-qz*y),2*(qz*x-qx*z),2*(qx*y-qy*x)
    return x+qw*tx+qy*tz-qz*ty,y+qw*ty+qz*tx-qx*tz,z+qw*tz+qx*ty-qy*tx

positions=[v for i in range(0,len(positions),3) for v in rotate(*positions[i:i+3])]
normals=[v for i in range(0,len(normals),3) for v in rotate(*normals[i:i+3])]
mins=[min(positions[a::3]) for a in range(3)]
maxs=[max(positions[a::3]) for a in range(3)]
scale=1.85/(maxs[1]-mins[1])
center=[(mins[0]+maxs[0])/2,mins[1],(mins[2]+maxs[2])/2]
positions=[round((v-center[i%3])*scale,6) for i,v in enumerate(positions)]
normals=[round(v,6) for v in normals]
uvs=[round(v,6) for v in uvs]
target.parent.mkdir(parents=True,exist_ok=True)
target.with_suffix('.json').write_text(json.dumps(dict(positions=positions,normals=normals,uvs=uvs,indices=indices,height=1.85),separators=(',',':')))
image=g['images'][0]
v=g['bufferViews'][image['bufferView']]
im=Image.open(io.BytesIO(binary[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']]))
im.thumbnail((1024,1024),Image.Resampling.LANCZOS)
# Optional, reproducible garden grade: lift chromatic baked fur shadows,
# while retaining near-black eyes/noses and keeping highlights below clipping.
if '--garden-grade' in sys.argv[3:]:
    import colorsys
    im = im.convert('RGBA')
    pixels = []
    for r, g, b, a in im.getdata():
        h, s, value = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        dark_guard = max(0.0, min(1.0, (value * 255 - 20) / 30))
        chroma_guard = max(0.0, min(1.0, (max(r, g, b) - min(r, g, b) - 6) / 20))
        weight = dark_guard * chroma_guard
        lifted = value + (value ** 0.68 - value) * weight * 0.90
        # Warm reflected fill rather than increasing exposure globally.
        saturation = s * (1 - 0.14 * weight * (1 - value))
        rr, gg, bb = colorsys.hsv_to_rgb(h, saturation, lifted)
        pixels.append((round(rr * 255), round(gg * 255), round(bb * 255), a))
    im.putdata(pixels)
im.save(target.with_suffix('.png'))
print(json.dumps({'vertices':len(positions)//3,'triangles':len(indices)//3,'texture':im.size,'height':1.85}))
