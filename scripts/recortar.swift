import Foundation
import Vision
import CoreImage
import CoreImage.CIFilterBuiltins
import ImageIO
import UniformTypeIdentifiers

// recortar <entrada> <saida.png> : pinta de transparente tudo o que não é o objecto principal
let a = CommandLine.arguments
guard a.count == 3 else { print("uso: recortar entrada saida.png"); exit(2) }
let url = URL(fileURLWithPath: a[1])
guard let src = CGImageSourceCreateWithURL(url as CFURL, nil),
      let cg = CGImageSourceCreateImageAtIndex(src, 0, nil) else { print("não li \(a[1])"); exit(1) }
let req = VNGenerateForegroundInstanceMaskRequest()
let h = VNImageRequestHandler(cgImage: cg, options: [:])
try h.perform([req])
guard let obs = req.results?.first else { print("sem objecto: \(a[1])"); exit(3) }
let buf = try obs.generateMaskedImage(ofInstances: obs.allInstances, from: h, croppedToInstancesExtent: false)
let ci = CIImage(cvPixelBuffer: buf)
let ctx = CIContext()
let out = URL(fileURLWithPath: a[2])
try ctx.writePNGRepresentation(of: ci, to: out, format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
print("ok \(a[2]) instâncias=\(obs.allInstances.count)")
