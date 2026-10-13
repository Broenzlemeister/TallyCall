# Tallycall

Controls a Tallycall run-of-show and shows its live state on your buttons. **Presets are built from your project automatically**: a new lower third, department, day or rundown item shows up as a new preset within seconds.

## Connect (pick one)
- **Connection code** (recommended): in Tallycall open the project → *Trigger* → *Create key / code*, copy the code and paste it here. One connection per project. Needs the Pro plan of the project owner.
- **Tallycall account**: server address, email, password and project name (empty if the account has only one project).
- **Local server**: server address, e.g. `http://192.168.1.20:4001`, and project name if there are several.

## Presets
Transport (next, previous, start/pause with remaining time, reset, roll mode), time ±1/±5 min, info (current / next item), one preset per saved **lower third** (toggle, lights up while live), **ready / not ready** per department, one preset per **day**, one preset per **rundown item** (green = running, yellow = loaded, blue = next).

## Actions
Start, pause, toggle, next, previous, reset, add/remove time, start/load item, select day, roll mode, department ready state, clear ready states, message on/off, lower third (saved / toggle / free text) on/off.

## Feedbacks
Running, paused, timer warning level, department ready / not ready, roll mode, lower third visible (any / this one), message visible, item running / loaded / next, day selected.

## Variables
`$(tallycall:remaining)`, `title`, `subtitle`, `presenter`, `next`, `day`, `status`, `level`, `elapsed`, `remaining_sec`, `added`, `message`, `lower`, `roll`, `project`, `ready_<department id>`.

## Triggering devices on site (Pixera, QLab …)
If Tallycall runs online and your devices sit in the venue network, let Companion bridge: use a Companion *trigger* on a Tallycall variable change or feedback and run the action of the device's own module.
