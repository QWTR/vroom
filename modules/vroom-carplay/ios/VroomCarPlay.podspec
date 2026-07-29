require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'VroomCarPlay'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = package['license']
  s.author         = 'VROOM'
  s.homepage       = 'https://v-room.app'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { :path => '.' }
  s.source_files   = '**/*.{h,m,mm,swift}'
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'MapboxMaps', '~> 11.18.2'
  s.dependency 'Turf'
  s.dependency 'Socket.IO-Client-Swift', '~> 16.1.1'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
