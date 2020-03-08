Controller application for the Weber lab Leica DMi8 microscope transmitted light.

The shutter controller in micromanager seems to hit a bug in the leica serial
interface that sometimes causes the shutter to get into a persistent error
state requiring a restart of the microscope. Because the light source does
not have a physical shutter, we can instead simulate one by remembering the
current intensity before setting it to 0 when closing the shutter, and then
restoring the value when opening the shutter. This appears to get around the
bug in the shutter serial interface.

This is meant to be set up as a user-defined serial device in micromanager.
For configs, see the weberlab-microscope-configs repository.
