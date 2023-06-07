import { exec } from "child_process"
import cors from "cors"
import * as dotenv from "dotenv"
import {
	BigNumberish,
	JsonRpcProvider,
	ethers,
	isAddress,
	keccak256,
	toUtf8Bytes,
} from "ethers"
import express from "express"
import fs from "fs"
dotenv.config()

const rpc = process.env.RPC

const pk =
	process.env.PK ||
	"0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" // anvil 0 account

const rpcUrl = rpc || "http://localhost:8545"
const constractAddress = process.env.MAIN_CONTRACT

console.log(pk, rpcUrl, constractAddress)

if (!constractAddress) {
	throw new Error("MAIN_CONTRACT is not set")
}

const provider = new JsonRpcProvider(rpcUrl)

const wallet = new ethers.Wallet(pk, provider)

console.log("wallet.address", wallet.address)

const contract = new ethers.Contract(
	constractAddress,
	[
		"function register(bytes32 login, uint passwordHash) external",
		"function transfer(bytes32 login, uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[2] memory input, address recepient, uint256 amount) external",
		"function isUserRegistered(bytes32 login) external view returns (bool)",
	],
	wallet,
)

const main = async () => {
	const app = express()

	app.use(express.json())
	app.use(cors())

	const port = process.env.PORT || 3000

	app.get("/", async (req, res) => {
		const blockNumber = await provider.getBlockNumber()
		res.send(`Current block number: ${blockNumber}`)
	})

	app.post("/register", async (req, res) => {
		console.log("req.body", req.body)
		const login = req.body.login
		const hashedPassword = req.body.hashedPassword

		// make sha256 hash of password
		const hashedLogin = keccak256(toUtf8Bytes(login))

		try {
			const isUserRegistered = await contract.isUserRegistered(hashedLogin)

			if (isUserRegistered) {
				return res.status(400).send("User already registered")
			}
			// rome-ignore lint/suspicious/noExplicitAny: <explanation>
		} catch (e: any) {
			console.log("isUserRegistered error", e.message)
			return res.status(500).send(e.message)
		}

		try {
			console.log("try to send register tx")

			const tx = await contract.register(hashedLogin, hashedPassword)

			console.log("wait for tx")
			const receipt = await tx.wait()

			console.log("receipt", JSON.stringify(receipt, null, 2))
			console.log("tx hash", tx.hash)
			res.send({ tx: tx.hash })
			// rome-ignore lint/suspicious/noExplicitAny: <explanation>
		} catch (e: any) {
			return res.status(500).send(e.message)
		}
	})

	app.get("/isUserRegistered/:login", async (req, res) => {
		const login = req.params.login
		const hashedLogin = keccak256(toUtf8Bytes(login))

		try {
			const isUserRegistered = await contract.isUserRegistered(hashedLogin)

			res.send({ isUserRegistered })
			// rome-ignore lint/suspicious/noExplicitAny: <explanation>
		} catch (e: any) {
			res.status(500).send(e.message)
		}
	})

	app.post("/login", async (req, res) => {
		const login = req.body.login

		const recepient = req.body.recepient

		console.log("recepient", recepient)

		if (!isAddress(recepient)) {
			res.status(400).send("recepient is not valid address")
			return
		}

		const hashedLogin = keccak256(toUtf8Bytes(login))

		const isUserRegistered = await contract.isUserRegistered(hashedLogin)

		console.log("isUserRegistered", isUserRegistered)

		if (!isUserRegistered) {
			return res.status(400).send("User is not registered")
		}

		const proof = req.body.proof
		const publicSignals = req.body.publicSignals

		// console.log("proof.json", JSON.stringify(proof, null, 2));
		// console.log("publicSignals", JSON.stringify(publicSignals, null, 2));

		fs.writeFileSync("proof.json", JSON.stringify(proof, null, 2))
		fs.writeFileSync("public.json", JSON.stringify(publicSignals, null, 2))

		console.log("snarkjs generatecall")

		const generatecall = async () => {
			try {
				return new Promise((resolve, reject) => {
					exec("snarkjs generatecall", (error, stdout, stderr) => {
						if (error) {
							console.log(`error: ${error.message}`)
							return reject(error)
						}
						if (stderr) {
							console.log(`stderr: ${stderr}`)
							return reject(stderr)
						}
						// console.log(`stdout: ${stdout}`);
						return resolve(stdout)
					})
				})
			} catch (e) {
				console.log(e)
			}
		}

		const data = (await generatecall()) as string

		console.log("data", data)

		const call = JSON.parse(`[${data}]` as string)

		const a = call[0]
		const b = call[1]
		const c = call[2]
		const input = call[3]
		const amount = "100000000000000"

		console.log("a", a)
		console.log("b", b)
		console.log("c", c)
		console.log("input", input)

		console.log("hashedLogin", hashedLogin)
		console.log(a, b, c, input, recepient, amount)

		try {
			console.log("send contract.transfer")
			const tx = await contract.transfer(
				hashedLogin,
				a,
				b,
				c,
				input,
				recepient,
				amount,
			)

			console.log("wait for tx")
			const receipt = await tx.wait()

			console.log("receipt", receipt)
			res.send({ tx: tx.hash })
			// rome-ignore lint/suspicious/noExplicitAny: <explanation>
		} catch (e: any) {
			console.log("error", e.message)
			return res.status(500).send(e.message)
		}
	})

	app.listen(port, () => {
		console.log(`Example app listening at http://localhost:${port}`)
	})
}

main()
